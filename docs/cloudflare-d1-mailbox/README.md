# Cloudflare D1 邮箱模板

这套模板对应当前仓库里新增的 `cloudflare-d1` 邮箱 provider。

## 作用边界

扩展侧现在只负责两件事：

1. 生成 `localpart@你的域名`
2. 在步骤 4 / 7 查询 D1 里的验证码

真正的收信链路仍然需要你自己部署：

- 域名收件
- 邮件解析
- 写入 D1

这里提供的是一套**最小可用模板**。

---

## 目录说明

- `schema.sql`：D1 建表 SQL
- `email-worker.js`：Cloudflare Email Worker 模板
- `wrangler.toml.example`：Wrangler 示例配置
- `../../workers/cloudflare-d1-mailbox/`：半自动部署目录
- `../../scripts/deploy_cloudflare_d1_mailbox.py`：Python 半自动部署脚本

---

## 表结构说明

你要求的邮件留档表头如下：

| id | email | subject | body | has_code | code | stage | source | created_at |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

模板里的 `emails` 表就是按这个结构建的。

另外我**额外保留了一张 `codes` 表**，原因是当前扩展的 D1 provider 查询语句固定是：

```sql
SELECT code, received_at
FROM codes
WHERE email = ?
ORDER BY received_at DESC
LIMIT 5
```

所以：

- `emails`：用于完整留档、排障、人工排查
- `codes`：用于插件快速轮询取码

如果你只保留 `emails` 而不建 `codes`，当前扩展版本不能直接工作。

---

## 半自动部署

如果你本机已经：

- 安装了 `wrangler`
- 执行过 `wrangler login`

那么推荐直接在仓库根目录运行：

```bash
python scripts/deploy_cloudflare_d1_mailbox.py
```

脚本会：

1. 检查 wrangler
2. 询问 Worker 名称 / Account ID / D1 名称
3. 可选自动创建 D1
4. 生成 `.generated/<worker-name>/wrangler.toml`
5. 执行 `schema.sql`
6. 调用 `wrangler deploy`

如果你只想生成配置、不立刻部署：

```bash
python scripts/deploy_cloudflare_d1_mailbox.py --skip-deploy
```

---

## 手动初始化 D1

先建库：

```bash
wrangler d1 create codex-d1-mailbox
```

然后执行 schema：

```bash
wrangler d1 execute codex-d1-mailbox --file=./schema.sql
```

你也可以手动执行 `schema.sql` 里的 SQL。

---

## Worker 绑定方式

1. 把 `wrangler.toml.example` 复制成 `wrangler.toml`
2. 把里面的 `database_id` 改成你的 D1 Database ID
3. 保持 `binding = "DB"`
4. 把 `email-worker.js` 放在 Worker 入口位置

---

## 邮件 Worker 的行为

模板 Worker 会：

1. 读取原始 MIME 邮件
2. 尝试提取：
   - `Subject`
   - `text/plain`
   - `text/html`
3. 优先把完整 HTML 写到 `emails.body`
4. 自动提取 6 位验证码
5. 有验证码时同时写：
   - `emails`
   - `codes`
6. 没验证码时只写：
   - `emails`
7. 定期清理过期数据

默认清理策略：

- `emails` 保留 30 天
- `codes` 保留 2 天

可通过环境变量覆盖：

- `EMAIL_RETENTION_DAYS`
- `CODE_RETENTION_DAYS`

---

## 扩展侧需要填什么

在当前扩展侧边栏里，选择：

- `邮箱服务 = Cloudflare D1 邮箱`

然后配置：

- `Account ID`
- `Database ID`
- `API Token`
- `D1 域名`

如果你配置多个节点，扩展会在每轮步骤 3 随机选一个节点。

---

## API Token 权限

这个 Token 至少需要：

- D1 读权限

因为扩展只做 D1 查询，不负责写入邮件。

如果你把写入逻辑也放在其他 Worker/服务里，那写入侧还需要对应写权限。

---

## 推荐联调顺序

1. 先建 D1 库并执行 `schema.sql`
2. 部署收信 Worker
3. 手工给目标邮箱发一封带 6 位验证码的测试邮件
4. 确认：
   - `emails` 有记录
   - `codes` 有记录
5. 再到扩展里配置 D1 节点
6. 跑注册流程

---

## 自测 SQL

查看最近邮件：

```sql
SELECT * FROM emails ORDER BY id DESC LIMIT 20;
```

查看最近验证码：

```sql
SELECT * FROM codes ORDER BY id DESC LIMIT 20;
```

按邮箱测试插件查询逻辑：

```sql
SELECT code, received_at
FROM codes
WHERE email = 'your-test@example.com'
ORDER BY received_at DESC
LIMIT 5;
```

---

## 注意事项

1. `email` 建议统一写小写
2. `received_at` / `created_at` 建议统一 ISO 时间字符串
3. 如果你的真实邮件来源里 `login` / `register` 判定规则不同，可以自行改 `stage`
4. 如果你以后想把扩展改成直接查 `emails` 而不是 `codes`，那是另一轮改动；当前模板先保证和已合入的扩展逻辑兼容
