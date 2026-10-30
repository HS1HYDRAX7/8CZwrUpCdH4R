-- Platform-level identity and moderation
ALTER TABLE users ADD COLUMN is_platform_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verified_color TEXT NOT NULL DEFAULT '#3b82f6';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online';
ALTER TABLE users ADD COLUMN custom_status TEXT NOT NULL DEFAULT '';

-- Custom badges granted only by platform owner (users cannot remove their own)
CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '★',
  color TEXT NOT NULL DEFAULT '#e11d2e',
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  granted_by TEXT REFERENCES users(id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges (user_id);

-- Platform bans / suspensions (global)
CREATE TABLE IF NOT EXISTS platform_sanctions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_sanctions_user ON platform_sanctions (user_id, active);

-- Server-level bans
CREATE TABLE IF NOT EXISTS server_bans (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  banned_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (server_id, user_id)
);
