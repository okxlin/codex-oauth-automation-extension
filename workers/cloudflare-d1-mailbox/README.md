# Cloudflare D1 邮箱 Worker

这个目录用于配合 `scripts/deploy_cloudflare_d1_mailbox.py` 做半自动部署。

## 内容

- `src/email-worker.js`：Worker 入口模板
- `schema.sql`：D1 初始化表结构
- `wrangler.toml.template`：Wrangler 配置模板
- `.generated/`：部署脚本生成的可部署目录（默认不进 git）

## 推荐用法

在仓库根目录执行：

```bash
python scripts/deploy_cloudflare_d1_mailbox.py
```

脚本会引导你：

1. 检查 `wrangler` 是否已安装
2. 选择新建 D1 或复用已有 D1
3. 写入 `wrangler.toml`
4. 执行 `schema.sql`
5. 部署 Worker

更完整说明见：

- `docs/cloudflare-d1-mailbox/README.md`
