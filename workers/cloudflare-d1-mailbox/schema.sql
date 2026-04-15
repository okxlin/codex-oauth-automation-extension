-- Cloudflare D1 mailbox schema
-- 当前扩展的 Cloudflare D1 provider 会查询：
--   SELECT code, received_at FROM codes WHERE email = ? ORDER BY received_at DESC LIMIT 5

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  has_code INTEGER NOT NULL DEFAULT 0,
  code TEXT DEFAULT '',
  stage TEXT DEFAULT 'register',
  source TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  stage TEXT DEFAULT 'register',
  source TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_email_created_at
  ON emails(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_codes_email_received_at
  ON codes(email, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_codes_email_stage_received_at
  ON codes(email, stage, received_at DESC);
