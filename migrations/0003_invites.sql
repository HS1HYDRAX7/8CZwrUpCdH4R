CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invites_server ON invites (server_id);
