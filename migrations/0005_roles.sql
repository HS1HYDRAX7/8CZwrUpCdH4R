-- Basic roles system (owner always has full power; permissions checked server-side)
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#99aab5',
  position INTEGER NOT NULL DEFAULT 0,
  permissions INTEGER NOT NULL DEFAULT 0,
  hoist INTEGER NOT NULL DEFAULT 0,
  mentionable INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_roles (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_roles_server ON roles (server_id);
CREATE INDEX IF NOT EXISTS idx_member_roles_user ON member_roles (user_id);

-- Permission bitflags (simplified Discord-style)
-- 1 << 0  ADMINISTRATOR
-- 1 << 1  MANAGE_SERVER
-- 1 << 2  MANAGE_ROLES
-- 1 << 3  MANAGE_CHANNELS
-- 1 << 4  MANAGE_INVITES
-- 1 << 5  KICK_MEMBERS
-- 1 << 6  BAN_MEMBERS
-- 1 << 7  VIEW_CHANNELS
-- 1 << 8  SEND_MESSAGES
-- 1 << 9  MANAGE_MESSAGES
-- 1 << 10 ATTACH_FILES
-- 1 << 11 CONNECT (voice)
-- 1 << 12 SPEAK
