import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path
from string import Template


ROOT_DIR = Path(__file__).resolve().parents[1]
WORKER_TEMPLATE_DIR = ROOT_DIR / "workers" / "cloudflare-d1-mailbox"
GENERATED_ROOT = WORKER_TEMPLATE_DIR / ".generated"
TEMPLATE_WRANGLER = WORKER_TEMPLATE_DIR / "wrangler.toml.template"
TEMPLATE_SCHEMA = WORKER_TEMPLATE_DIR / "schema.sql"
TEMPLATE_WORKER = WORKER_TEMPLATE_DIR / "src" / "email-worker.js"


def log(message: str) -> None:
    print(f"[D1Deploy] {message}", flush=True)


def fail(message: str, code: int = 1) -> int:
    print(f"[D1Deploy][ERROR] {message}", file=sys.stderr, flush=True)
    return code


def prompt(label: str, default: str = "", required: bool = False) -> str:
    hint = f" [{default}]" if default else ""
    while True:
        value = input(f"{label}{hint}: ").strip()
        if value:
            return value
        if default:
            return default
        if not required:
            return ""
        print("该项不能为空，请重新输入。", flush=True)


def prompt_yes_no(label: str, default: bool = True) -> bool:
    default_hint = "Y/n" if default else "y/N"
    while True:
        value = input(f"{label} [{default_hint}]: ").strip().lower()
        if not value:
            return default
        if value in {"y", "yes"}:
            return True
        if value in {"n", "no"}:
            return False
        print("请输入 y 或 n。", flush=True)


def sanitize_name(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "").strip()).strip("-")
    return normalized or fallback


def run_command(command, cwd: Path, check: bool = True) -> subprocess.CompletedProcess:
    log(f"运行命令: {' '.join(command)}")
    result = subprocess.run(
        command,
        cwd=str(cwd),
        text=True,
        capture_output=True,
    )
    if result.stdout.strip():
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if result.stderr.strip():
        print(result.stderr, file=sys.stderr, end="" if result.stderr.endswith("\n") else "\n")
    if check and result.returncode != 0:
        raise RuntimeError(f"命令失败: {' '.join(command)}")
    return result


def check_wrangler_available() -> None:
    if shutil.which("wrangler") is None:
        raise RuntimeError("未检测到 wrangler，请先安装并完成 `wrangler login`。")
    run_command(["wrangler", "--version"], cwd=ROOT_DIR)


def parse_database_id(output: str) -> str:
    patterns = [
        r'"uuid"\s*:\s*"([^"]+)"',
        r'"database_id"\s*:\s*"([^"]+)"',
        r"database_id\s*=\s*\"([^\"]+)\"",
    ]
    for pattern in patterns:
        match = re.search(pattern, output, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def create_database(database_name: str) -> str:
    result = run_command(["wrangler", "d1", "create", database_name], cwd=ROOT_DIR)
    database_id = parse_database_id((result.stdout or "") + "\n" + (result.stderr or ""))
    if not database_id:
        raise RuntimeError("已执行 `wrangler d1 create`，但无法从输出中解析 database_id，请手工重试。")
    log(f"已创建 D1 数据库: {database_name} ({database_id})")
    return database_id


def ensure_generated_dir(worker_name: str) -> Path:
    target_dir = GENERATED_ROOT / sanitize_name(worker_name, "codex-d1-mailbox-worker")
    (target_dir / "src").mkdir(parents=True, exist_ok=True)
    return target_dir


def write_templates(target_dir: Path, substitutions: dict) -> None:
    worker_text = TEMPLATE_WORKER.read_text(encoding="utf-8")
    schema_text = TEMPLATE_SCHEMA.read_text(encoding="utf-8")
    wrangler_template = Template(TEMPLATE_WRANGLER.read_text(encoding="utf-8"))
    wrangler_text = wrangler_template.safe_substitute(substitutions)

    (target_dir / "src" / "email-worker.js").write_text(worker_text, encoding="utf-8")
    (target_dir / "schema.sql").write_text(schema_text, encoding="utf-8")
    (target_dir / "wrangler.toml").write_text(wrangler_text, encoding="utf-8")

    config = {
        "worker_name": substitutions["WORKER_NAME"],
        "account_id": substitutions["ACCOUNT_ID"],
        "database_name": substitutions["DATABASE_NAME"],
        "database_id": substitutions["DATABASE_ID"],
        "email_retention_days": substitutions["EMAIL_RETENTION_DAYS"],
        "code_retention_days": substitutions["CODE_RETENTION_DAYS"],
        "compatibility_date": substitutions["COMPATIBILITY_DATE"],
    }
    (target_dir / "deploy-config.json").write_text(
        json.dumps(config, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def execute_schema(target_dir: Path, database_name: str, remote: bool) -> None:
    command = ["wrangler", "d1", "execute", database_name, "--file=./schema.sql"]
    if remote:
        command.append("--remote")
    run_command(command, cwd=target_dir)


def deploy_worker(target_dir: Path) -> None:
    run_command(["wrangler", "deploy"], cwd=target_dir)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="半自动部署 Cloudflare D1 邮箱 Worker")
    parser.add_argument("--worker-name", default="", help="Worker 名称")
    parser.add_argument("--account-id", default="", help="Cloudflare Account ID")
    parser.add_argument("--database-name", default="", help="D1 数据库名称")
    parser.add_argument("--database-id", default="", help="已有 D1 Database ID；提供时跳过创建")
    parser.add_argument("--email-retention-days", default="30", help="emails 保留天数")
    parser.add_argument("--code-retention-days", default="2", help="codes 保留天数")
    parser.add_argument("--compatibility-date", default=str(date.today()), help="Wrangler compatibility_date")
    parser.add_argument("--skip-create-db", action="store_true", help="跳过 D1 创建")
    parser.add_argument("--skip-schema", action="store_true", help="跳过 schema 执行")
    parser.add_argument("--skip-deploy", action="store_true", help="只生成部署目录，不执行 deploy")
    parser.add_argument("--remote-schema", action="store_true", help="执行 schema 时附带 --remote")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        check_wrangler_available()

        worker_name = args.worker_name or prompt("Worker 名称", "codex-d1-mailbox-worker", required=True)
        account_id = args.account_id or prompt("Cloudflare Account ID", required=True)
        database_name = args.database_name or prompt("D1 数据库名称", "codex-d1-mailbox", required=True)
        database_id = args.database_id.strip()

        if not database_id and not args.skip_create_db:
            if prompt_yes_no("未提供 Database ID，是否现在用 wrangler 自动创建 D1 数据库？", True):
                database_id = create_database(database_name)
            else:
                database_id = prompt("请输入已有 D1 Database ID", required=True)

        if not database_id:
            database_id = prompt("D1 Database ID", required=True)

        email_retention_days = str(args.email_retention_days or prompt("emails 保留天数", "30", required=True))
        code_retention_days = str(args.code_retention_days or prompt("codes 保留天数", "2", required=True))
        compatibility_date = str(args.compatibility_date or date.today())

        target_dir = ensure_generated_dir(worker_name)
        substitutions = {
            "WORKER_NAME": worker_name,
            "ACCOUNT_ID": account_id,
            "DATABASE_NAME": database_name,
            "DATABASE_ID": database_id,
            "EMAIL_RETENTION_DAYS": email_retention_days,
            "CODE_RETENTION_DAYS": code_retention_days,
            "COMPATIBILITY_DATE": compatibility_date,
        }
        write_templates(target_dir, substitutions)
        log(f"已生成部署目录: {target_dir}")

        if not args.skip_schema:
            execute_schema(target_dir, database_name, remote=args.remote_schema)
        else:
            log("已跳过 schema 执行。")

        if not args.skip_deploy:
            deploy_worker(target_dir)
        else:
            log("已跳过 wrangler deploy。")

        print()
        log("部署流程完成。你现在可以：")
        log(f"1. 在扩展中填入 Account ID = {account_id}")
        log(f"2. Database ID = {database_id}")
        log("3. 填入具备 D1 读取权限的 API Token")
        log("4. 在扩展里继续配置 D1 域名 / 多节点")
        return 0
    except KeyboardInterrupt:
        return fail("用户取消。")
    except Exception as exc:
        return fail(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
