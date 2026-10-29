import { b2Problem, b2Config, b2Put, b2Get, b2Delete } from './b2.js';
import { routeBotToken, handleFeatureRoute, respondToMessage } from './features.js';
import { SCHEMA_STATEMENTS } from './schema.js';

const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 2000;
const PAGE_SIZE = 50;
const POLL_LIMIT = 100;
const PBKDF2_ITERATIONS = 100000;
const DUMMY_HASH = 'pbkdf2$100000$' + '0'.repeat(32) + '$' + '0'.repeat(64);
const REQUEST_HEADER = 'Hellcord';

const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/flac',
  'video/mp4', 'video/webm',
]);
const ATTACHMENT_TYPES = new Set(['application/pdf', 'text/plain', 'application/zip']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const MESSAGE_SELECT = `SELECT m.id, m.content, m.created_at, m.edited_at, m.author_id, u.username, u.display_name, u.avatar_file_id, u.frame, u.is_bot, m.file_id,
  f.name AS file_name, f.mime AS file_mime, f.size AS file_size
  FROM messages m
  JOIN users u ON u.id = m.author_id
  LEFT JOIN files f ON f.id = m.file_id`;

const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Creates the tables on first use, so no terminal step is needed. Runs once per worker instance.
let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  // Always run the full statement list. CREATE TABLE IF NOT EXISTS and
  // ALTER TABLE ... ADD COLUMN are safe to re-run: duplicates are ignored.
  // The old early-return (when base tables already existed) skipped new
  // columns like display_name and broke login/me after deploy.
  for (const statement of SCHEMA_STATEMENTS) {
    try {
      await env.DB.prepare(statement).run();
    } catch (err) {
      const msg = String(err?.message || '');
      // duplicate column / table / index = already applied, keep going
      if (!/duplicate column|already exists|unique constraint/i.test(msg)) {
        console.error('schema statement failed', msg.slice(0, 200));
        // still continue so one bad ALTER does not block the rest
      }
    }
  }
  schemaReady = true;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      await ensureSchema(env).catch((err) => console.error('schema setup failed', err));
      try {
        return await handleApi(request, env, url, ctx);
      } catch (err) {
        if (err instanceof HttpError || err?.name === 'HttpError') return json({ error: err.message }, err.status);
        console.error('api error', err);
        const msg = String(err?.message || '');
        if (/no such table/i.test(msg)) {
          return json({ error: 'The database tables are missing. Run: npx wrangler d1 migrations apply hellcord --remote' }, 503);
        }
        if (/no such column/i.test(msg)) {
          return json({
            error: 'Database is missing a column (schema outdated). Redeploy and wait a few seconds, or run: npx wrangler d1 migrations apply hellcord --remote',
          }, 503);
        }
        return json({ error: 'Something went wrong.' }, 500);
      }
    }
    const asset = await env.ASSETS.fetch(request);
    return withHeaders(asset, { 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  },
};

// ---------- responses and small helpers ----------

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return Uint8Array.from(hex.match(/../g).map((pair) => parseInt(pair, 16)));
}

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteCount = 32) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cleanText(value, min, max) {
  const text = String(value ?? '').trim();
  return text.length >= min && text.length <= max ? text : null;
}

function cleanFileName(raw) {
  let name = String(raw || '');
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw value when it is not valid percent-encoding
  }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f<>"]/g, '').trim();
  return (name || 'file').slice(0, 120);
}

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Send JSON.');
  try {
    const value = await request.json();
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

// ---------- passwords and sessions ----------

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return ['pbkdf2', PBKDF2_ITERATIONS, toHex(salt), toHex(hash)].join('$');
}

async function verifyPassword(password, stored) {
  const [scheme, iterations, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const hash = toHex(await pbkdf2(password, fromHex(saltHex), Number(iterations)));
  return timingSafeEqual(hash, hashHex);
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

function sessionCookie(token, maxAge) {
  return `hc_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function createSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_SECONDS * 1000)
    .run();
  return token;
}

async function currentUser(request, env) {
  const token = readCookie(request, 'hc_session');
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(await sha256Hex(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
  };
}

// ---------- auth handlers ----------

async function register(request, env) {
  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
    throw new HttpError(400, 'Username: 3 to 24 letters, numbers, dots, dashes or underscores.');
  }
  if (password.length < 8 || password.length > 200) {
    throw new HttpError(400, 'Password must be 8 to 200 characters.');
  }
  const taken = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first();
  if (taken) throw new HttpError(409, 'That username is taken.');

  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, username, await hashPassword(password), Date.now())
    .run();
  const token = await createSession(env, id);
  return json({ user: { id, username } }, 201, { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) });
}

async function login(request, env) {
  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const row = await env.DB.prepare('SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username)
    .first();
  // Always run one hash check so the response time does not reveal which usernames exist.
  const passwordOk = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !passwordOk) throw new HttpError(401, 'Wrong username or password.');
  const token = await createSession(env, row.id);
  return json({ user: { id: row.id, username: row.username } }, 200, {
    'Set-Cookie': sessionCookie(token, SESSION_SECONDS),
  });
}

async function logout(request, env) {
  const token = readCookie(request, 'hc_session');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// ---------- servers and channels ----------

async function requireMembership(env, serverId, userId) {
  const server = await env.DB.prepare(
    `SELECT s.id, s.name, s.owner_id, s.invite_code
     FROM servers s JOIN server_members m ON m.server_id = s.id
     WHERE s.id = ? AND m.user_id = ?`
  ).bind(serverId, userId).first();
  if (!server) throw new HttpError(404, 'Server not found.');
  return server;
}

async function channelForMember(env, channelId, userId) {
  const channel = await env.DB.prepare(
    `SELECT c.id, c.server_id, c.name
     FROM channels c JOIN server_members m ON m.server_id = c.server_id
     WHERE c.id = ? AND m.user_id = ?`
  ).bind(channelId, userId).first();
  if (!channel) throw new HttpError(404, 'Channel not found.');
  return channel;
}

async function listServers(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.owner_id
     FROM servers s JOIN server_members m ON m.server_id = s.id
     WHERE m.user_id = ?
     ORDER BY s.name COLLATE NOCASE`
  ).bind(user.id).all();
  return json({ servers: results });
}

async function createServer(request, env, user) {
  const body = await readJson(request);
  const name = cleanText(body.name, 2, 40);
  if (!name) throw new HttpError(400, 'Server names are 2 to 40 characters.');
  const id = crypto.randomUUID();
  const invite = randomToken(6);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, name, user.id, invite, now),
    env.DB.prepare('INSERT INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)')
      .bind(id, user.id, now),
    env.DB.prepare('INSERT INTO channels (id, server_id, name, position, created_at) VALUES (?, ?, ?, 0, ?)')
      .bind(crypto.randomUUID(), id, 'general', now),
  ]);
  return json({ server: { id, name, owner_id: user.id, invite_code: invite } }, 201);
}

async function joinServer(request, env, user) {
  const body = await readJson(request);
  const invite = String(body.invite || '').trim();
  const server = await env.DB.prepare('SELECT id, name, owner_id FROM servers WHERE invite_code = ?').bind(invite).first();
  if (!server) throw new HttpError(404, 'That invite does not exist.');
  await env.DB.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)')
    .bind(server.id, user.id, Date.now())
    .run();
  return json({ server });
}

async function getServer(env, user, serverId) {
  const server = await requireMembership(env, serverId, user.id);
  const full = await env.DB.prepare(
    'SELECT id, name, owner_id, invite_code, icon_file_id, description FROM servers WHERE id = ?'
  ).bind(serverId).first();
  const [channels, members, categories] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, name, type, topic, category_id, position FROM channels WHERE server_id = ? ORDER BY position, created_at'
    ).bind(serverId),
    env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_file_id, u.frame FROM server_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.server_id = ? ORDER BY u.username COLLATE NOCASE`
    ).bind(serverId),
    env.DB.prepare(
      'SELECT id, name, position FROM categories WHERE server_id = ? ORDER BY position, created_at'
    ).bind(serverId),
  ]);
  return json({
    server: {
      id: full.id,
      name: full.name,
      owner_id: full.owner_id,
      invite_code: full.invite_code,
      icon: full.icon_file_id || null,
      description: full.description || '',
    },
    channels: channels.results.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type || 'text',
      topic: c.topic || '',
      categoryId: c.category_id || null,
      position: c.position,
    })),
    categories: categories.results || [],
    members: members.results.map((m) => ({
      id: m.id,
      username: m.username,
      displayName: m.display_name || m.username,
      avatar: m.avatar_file_id || null,
      frame: m.frame || 'none',
    })),
  });
}

async function createChannel(request, env, user, serverId) {
  const server = await requireMembership(env, serverId, user.id);
  if (server.owner_id !== user.id) throw new HttpError(403, 'Only the server owner can create channels.');
  const body = await readJson(request);
  const name = cleanText(body.name, 2, 32)?.toLowerCase().replace(/\s+/g, '-');
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new HttpError(400, 'Channel names use letters, numbers and dashes.');
  }
  const type = String(body.type || 'text').toLowerCase() === 'voice' ? 'voice' : 'text';
  const topic = String(body.topic || '').trim().slice(0, 200);
  const categoryId = body.categoryId ? String(body.categoryId) : null;
  if (categoryId) {
    const cat = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND server_id = ?')
      .bind(categoryId, serverId).first();
    if (!cat) throw new HttpError(400, 'Category not found in this server.');
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO channels (id, server_id, name, position, created_at, type, topic, category_id)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM channels WHERE server_id = ?), ?, ?, ?, ?)`
  ).bind(id, serverId, name, serverId, Date.now(), type, topic, categoryId).run();
  return json({ channel: { id, name, type, topic, categoryId } }, 201);
}

async function updateServer(request, env, user, serverId) {
  const server = await requireMembership(env, serverId, user.id);
  if (server.owner_id !== user.id) throw new HttpError(403, 'Only the owner can edit the server.');
  const body = await readJson(request);
  const name = body.name !== undefined ? cleanText(body.name, 2, 40) : null;
  if (body.name !== undefined && !name) throw new HttpError(400, 'Server names are 2 to 40 characters.');
  const description = body.description !== undefined ? String(body.description || '').trim().slice(0, 300) : null;
  if (name !== null) {
    await env.DB.prepare('UPDATE servers SET name = ? WHERE id = ?').bind(name, serverId).run();
  }
  if (description !== null) {
    await env.DB.prepare('UPDATE servers SET description = ? WHERE id = ?').bind(description, serverId).run();
  }
  const row = await env.DB.prepare('SELECT id, name, owner_id, invite_code, icon_file_id, description FROM servers WHERE id = ?')
    .bind(serverId).first();
  return json({
    server: {
      id: row.id, name: row.name, owner_id: row.owner_id, invite_code: row.invite_code,
      icon: row.icon_file_id || null, description: row.description || '',
    },
  });
}

async function deleteServer(env, user, serverId) {
  const server = await requireMembership(env, serverId, user.id);
  if (server.owner_id !== user.id) throw new HttpError(403, 'Only the owner can delete the server.');
  await env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(serverId).run();
  return json({ ok: true });
}

async function createCategory(request, env, user, serverId) {
  const server = await requireMembership(env, serverId, user.id);
  if (server.owner_id !== user.id) throw new HttpError(403, 'Only the owner can create categories.');
  const body = await readJson(request);
  const name = cleanText(body.name, 1, 40);
  if (!name) throw new HttpError(400, 'Category name is required.');
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO categories (id, server_id, name, position, created_at)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories WHERE server_id = ?), ?)`
  ).bind(id, serverId, name, serverId, Date.now()).run();
  return json({ category: { id, name } }, 201);
}

// ---------- messages ----------

function toMessage(row) {
  return {
    id: row.id,
    content: row.content,
    created_at: row.created_at,
    edited_at: row.edited_at || null,
    author: {
      id: row.author_id,
      username: row.username,
      displayName: row.display_name || row.username,
      avatar: row.avatar_file_id || null,
      frame: row.frame || 'none',
      bot: Boolean(row.is_bot),
    },
    file: row.file_id
      ? { id: row.file_id, name: row.file_name, mime: row.file_mime, size: row.file_size }
      : null,
  };
}

async function listMessages(url, env, user, channelId) {
  await channelForMember(env, channelId, user.id);
  const after = Number(url.searchParams.get('after') || 0);
  const before = Number(url.searchParams.get('before') || 0);
  if (after) {
    const { results } = await env.DB.prepare(
      `${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.deleted = 0 AND m.id > ? ORDER BY m.id ASC LIMIT ${POLL_LIMIT}`
    ).bind(channelId, after).all();
    return json({ messages: results.map(toMessage) });
  }
  const cutoff = before || Number.MAX_SAFE_INTEGER;
  const { results } = await env.DB.prepare(
    `${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.deleted = 0 AND m.id < ? ORDER BY m.id DESC LIMIT ${PAGE_SIZE}`
  ).bind(channelId, cutoff).all();
  return json({ messages: results.reverse().map(toMessage) });
}

async function postMessage(request, env, user, channelId, ctx) {
  const channel = await channelForMember(env, channelId, user.id);
  const body = await readJson(request);
  const content = String(body.content ?? '').trim();
  if (content.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, `Messages can be at most ${MAX_MESSAGE_CHARS} characters.`);
  }
  const fileId = body.fileId ? String(body.fileId) : null;
  if (!content && !fileId) throw new HttpError(400, 'Write something or attach a file.');

  if (fileId) {
    const file = await env.DB.prepare('SELECT id FROM files WHERE id = ? AND owner_id = ? AND channel_id = ?')
      .bind(fileId, user.id, channelId)
      .first();
    if (!file) throw new HttpError(400, 'That attachment was not found.');
    const used = await env.DB.prepare('SELECT id FROM messages WHERE file_id = ?').bind(fileId).first();
    if (used) throw new HttpError(409, 'That attachment was already sent.');
  }

  const result = await env.DB.prepare(
    'INSERT INTO messages (channel_id, author_id, content, file_id, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(channelId, user.id, content, fileId, Date.now()).run();
  const row = await env.DB.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).bind(result.meta.last_row_id).first();
  ctx?.waitUntil?.(respondToMessage({
    env, serverId: channel.server_id, channelId, author: { id: user.id, username: user.username },
    content, messageId: result.meta.last_row_id,
  }));
  return json({ message: toMessage(row) }, 201);
}

async function deleteMessage(env, user, messageId) {
  const row = await env.DB.prepare(
    `SELECT m.id, m.author_id, m.file_id, c.server_id
     FROM messages m JOIN channels c ON c.id = m.channel_id
     WHERE m.id = ? AND m.deleted = 0`
  ).bind(messageId).first();
  if (!row) throw new HttpError(404, 'Message not found.');
  const server = await env.DB.prepare('SELECT owner_id FROM servers WHERE id = ?').bind(row.server_id).first();
  if (row.author_id !== user.id && (!server || server.owner_id !== user.id)) {
    throw new HttpError(403, 'You can only delete your own messages.');
  }
  await env.DB.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').bind(messageId).run();
  if (row.file_id) await removeFile(env, row.file_id);
  return json({ ok: true });
}

// ---------- files (Backblaze B2) ----------

async function removeFile(env, fileId) {
  const file = await env.DB.prepare('SELECT storage_key FROM files WHERE id = ?').bind(fileId).first();
  if (!file) return;
  if (b2Config(env).configured) await b2Delete(env, file.storage_key).catch((err) => console.error('b2 delete', err));
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();
}

async function uploadFile(request, env, user, channelId) {
  await channelForMember(env, channelId, user.id);
  if (!b2Config(env).configured) throw new HttpError(503, b2Problem(env));

  const mime = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!INLINE_TYPES.has(mime) && !ATTACHMENT_TYPES.has(mime)) {
    throw new HttpError(415, 'That file type is not allowed.');
  }
  if (Number(request.headers.get('Content-Length') || 0) > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'Files can be at most 25 MB.');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) throw new HttpError(400, 'That file is empty.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Files can be at most 25 MB.');

  const id = crypto.randomUUID();
  const storageKey = `hellcord/${id}`;
  const name = cleanFileName(request.headers.get('X-File-Name'));
  await b2Put(env, storageKey, bytes, mime);
  await env.DB.prepare(
    `INSERT INTO files (id, owner_id, channel_id, storage_key, name, mime, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, channelId, storageKey, name, mime, bytes.byteLength, Date.now()).run();
  return json({ file: { id, name, mime, size: bytes.byteLength } }, 201);
}

async function serveFile(env, user, fileId) {
  const file = await env.DB.prepare(
    `SELECT f.storage_key, f.name, f.mime
     FROM files f
     JOIN channels c ON c.id = f.channel_id
     JOIN server_members m ON m.server_id = c.server_id
     WHERE f.id = ? AND m.user_id = ?`
  ).bind(fileId, user.id).first();
  if (!file) throw new HttpError(404, 'File not found.');
  const object = await b2Get(env, file.storage_key);
  if (!object) throw new HttpError(404, 'File not found.');

  const disposition = INLINE_TYPES.has(file.mime) ? 'inline' : 'attachment';
  const ascii = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return new Response(object.body, {
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, max-age=3600',
      ...SECURITY_HEADERS,
    },
  });
}

// ---------- router ----------

async function handleApi(request, env, url, ctx) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const method = request.method;

  if (parts[0] === 'health' && method === 'GET') {
    const required = ['users', 'sessions', 'servers', 'channels', 'messages', 'bots', 'emojis'];
    let found;
    try {
      const tables = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'sessions', 'servers', 'channels', 'messages', 'bots', 'emojis')"
      ).all();
      found = tables.results.map((row) => row.name);
    } catch (err) {
      return json({
        ok: false,
        database: `cannot read the database: ${String(err?.message || err).slice(0, 200)}`,
        storage: b2Config(env).configured ? 'configured' : b2Problem(env),
        bots: env.XKIRO_API_KEY ? 'AI bots available' : 'AI bots disabled (XKIRO_API_KEY not set)',
      });
    }
    const missing = required.filter((name) => !found.includes(name));
    return json({
      ok: missing.length === 0,
      database: missing.length === 0 ? 'ready' : `missing tables: ${missing.join(', ')}. Run: npx wrangler d1 migrations apply DB --remote`,
      storage: b2Config(env).configured ? 'configured' : b2Problem(env),
      bots: env.XKIRO_API_KEY ? 'AI bots available' : 'AI bots disabled (XKIRO_API_KEY not set)',
    });
  }

  // Every state-changing call must send a custom header. Browsers only add it from our own script,
  // so a cross-site form cannot make a logged-in user act.
  if (method !== 'GET' && request.headers.get('X-Requested-With') !== REQUEST_HEADER) {
    throw new HttpError(403, 'Missing request header.');
  }

  if (parts[0] === 'auth') {
    if (parts[1] === 'register' && method === 'POST') return register(request, env);
    if (parts[1] === 'login' && method === 'POST') return login(request, env);
    if (parts[1] === 'logout' && method === 'POST') return logout(request, env);
    throw new HttpError(404, 'Not found.');
  }

  const botResponse = await routeBotToken({ request, env, url, parts, ctx });
  if (botResponse) return botResponse;

  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Sign in first.');

  const featureResponse = await handleFeatureRoute({ request, env, user, url, parts, ctx });
  if (featureResponse) return featureResponse;

  if (parts[0] === 'me' && method === 'GET') return json({ user });

  if (parts[0] === 'servers') {
    if (!parts[1] && method === 'GET') return listServers(env, user);
    if (!parts[1] && method === 'POST') return createServer(request, env, user);
    if (parts[1] === 'join' && method === 'POST') return joinServer(request, env, user);
    if (parts[1] && !parts[2] && method === 'GET') return getServer(env, user, parts[1]);
    if (parts[1] && !parts[2] && method === 'PATCH') return updateServer(request, env, user, parts[1]);
    if (parts[1] && !parts[2] && method === 'DELETE') return deleteServer(env, user, parts[1]);
    if (parts[1] && parts[2] === 'channels' && method === 'POST') return createChannel(request, env, user, parts[1]);
    if (parts[1] && parts[2] === 'categories' && method === 'POST') return createCategory(request, env, user, parts[1]);
  }

  if (parts[0] === 'channels' && parts[1] && parts[2] === 'messages') {
    if (method === 'GET') return listMessages(url, env, user, parts[1]);
    if (method === 'POST') return postMessage(request, env, user, parts[1], ctx);
  }
  if (parts[0] === 'channels' && parts[1] && parts[2] === 'files' && method === 'POST') {
    return uploadFile(request, env, user, parts[1]);
  }
  if (parts[0] === 'messages' && parts[1] && method === 'DELETE') return deleteMessage(env, user, parts[1]);
  if (parts[0] === 'files' && parts[1] && method === 'GET') return serveFile(env, user, parts[1]);

  throw new HttpError(404, 'Not found.');
}
