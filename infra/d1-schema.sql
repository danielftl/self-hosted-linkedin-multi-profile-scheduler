-- ChatGPT Sites / Cloudflare D1 schema for the Buffer Replacement scheduler.
-- No local SQLite files are copied to the hosted database.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  person_urn TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  content TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  next_attempt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  remote_post_id TEXT
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status,next_attempt);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  job_id TEXT UNIQUE REFERENCES jobs(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS attachments_orphans ON attachments(job_id,created_at);
CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  oauth_state TEXT,
  oauth_expires_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
);
