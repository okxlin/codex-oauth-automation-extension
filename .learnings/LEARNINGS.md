## [LRN-20260412-001] correction

**Logged**: 2026-04-12T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
SUB2API 的 OpenAI Auth 链路不能误用 antigravity 的 OAuth 接口

### Details
本项目新增 SUB2API 模式时，用户明确纠正：`/api/v1/admin/antigravity/oauth/exchange-code` 属于反重力平台，不是 OpenAI Auth。随后通过后台前端产物确认，OpenAI Auth 正确链路是 `/api/v1/admin/openai/generate-auth-url` 与 `/api/v1/admin/openai/exchange-code`，最终创建账号仍调用 `/api/v1/admin/accounts`，并带 `platform: openai`、`type: oauth`。

### Suggested Action
后续接入 SUB2API / OpenAI Auth 时，优先以后台页面实际前端产物和真实接口为准，不再把 antigravity / gemini / openai 三套 OAuth 接口混用。

### Metadata
- Source: user_feedback
- Related Files: background.js, content/sub2api-panel.js
- Tags: sub2api, openai-auth, correction

---
