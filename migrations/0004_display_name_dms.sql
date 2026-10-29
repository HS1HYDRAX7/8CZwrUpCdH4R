-- Display name (nick) separate from username
ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';

-- Direct messages: 1:1 conversations
CREATE TABLE IF NOT EXISTS dm_channels (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dm_channel_id TEXT NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL DEFAULT '',
  file_id TEXT,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_channel ON dm_messages (dm_channel_id, id);
CREATE INDEX IF NOT EXISTS idx_dm_channels_user_a ON dm_channels (user_a);
CREATE INDEX IF NOT EXISTS idx_dm_channels_user_b ON dm_channels (user_b);

-- Orphan file cleanup tracking
ALTER TABLE files ADD COLUMN referenced INTEGER NOT NULL DEFAULT 1;
