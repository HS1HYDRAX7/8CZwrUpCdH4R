-- Server icon + description
ALTER TABLE servers ADD COLUMN icon_file_id TEXT;
ALTER TABLE servers ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- Channel type (text|voice) and optional category
ALTER TABLE channels ADD COLUMN type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE channels ADD COLUMN topic TEXT NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN category_id TEXT;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_server ON categories (server_id);

-- Friendships
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships (user_a, status);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships (user_b, status);

-- Blocks
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
