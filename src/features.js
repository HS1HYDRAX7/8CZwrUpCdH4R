import { b2Problem, b2Config, b2Put, b2Get, b2Delete } from './b2.js';

// Phase 2: profiles, message editing, typing, bots, custom emojis and profile files.

const MAX_MESSAGE_CHARS = 2000;
const TYPING_MS = 6000;
const BOT_HISTORY = 12;
const AI_TIMEOUT_MS = 25000;
const FRAMES = new Set([
  'none', 'ring', 'neon', 'flame', 'gold', 'aurora',
  'holographic', 'glitch', 'rainbow', 'diamond', 'cyber', 'void', 'pulse',
]);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const EMOJI_BYTES = 512 * 1024;
const encoder = new TextEncoder();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra },
  });
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

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

function randomToken(byteCount = 32) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function validUsername(value) {
  const name = String(value ?? '').trim();
  return /^[A-Za-z0-9_.-]{3,24}$/.test(name) ? name : null;
}

async function usernameTaken(env, username) {
  return Boolean(await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first());
}

// ---------- public entry points used by the Worker ----------

// Bot API: requests with "Authorization: Bearer hcb_..." act as the bot, without a session cookie.
export async function routeBotToken({ request, env, parts }) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer hcb_')) return null;
  const bot = await env.DB.prepare(
    `SELECT b.user_id, u.username FROM bots b JOIN users u ON u.id = b.user_id WHERE b.token_hash = ?`
  ).bind(await sha256Hex(header.slice(7).trim())).first();
  if (!bot) return json({ error: 'Invalid bot token.' }, 401);

  if (parts[0] === 'bot' && parts[1] === 'channels' && parts[3] === 'messages') {
    const channelId = parts[2];
    const access = await env.DB.prepare(
      `SELECT c.id FROM channels c JOIN server_members m ON m.server_id = c.server_id WHERE c.id = ? AND m.user_id = ?`
    ).bind(channelId, bot.user_id).first();
    if (!access) return json({ error: 'Channel not found.' }, 404);

    if (request.method === 'POST') {
      const body = await readJson(request);
      const content = String(body.content ?? '').trim();
      if (!content || content.length > MAX_MESSAGE_CHARS) return json({ error: `Messages are 1 to ${MAX_MESSAGE_CHARS} characters.` }, 400);
      const result = await env.DB.prepare(
        'INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?)'
      ).bind(channelId, bot.user_id, content, Date.now()).run();
      return json({ message: { id: result.meta.last_row_id, content, author: { id: bot.user_id, username: bot.username, bot: true } } }, 201);
    }
    if (request.method === 'GET') {
      const after = Number(new URL(request.url).searchParams.get('after') || 0);
      const { results } = await env.DB.prepare(
        `SELECT m.id, m.content, m.created_at, u.username, u.is_bot FROM messages m JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ? AND m.deleted = 0 AND m.id > ? ORDER BY m.id ASC LIMIT 100`
      ).bind(channelId, after).all();
      return json({ messages: results });
    }
  }
  return json({ error: 'Not found.' }, 404);
}

// Routes for the signed-in user. Returns null when the path is not handled here.
export async function handleFeatureRoute({ request, env, user, url, parts }) {
  const method = request.method;

  if (parts[0] === 'messages' && parts[1] && method === 'PATCH') return editMessage(request, env, user, parts[1]);

  if (parts[0] === 'channels' && parts[1] && parts[2] === 'typing') {
    if (method === 'GET') return listTyping(env, user, parts[1]);
    if (method === 'POST') return setTypingRoute(env, user, parts[1]);
  }
  if (parts[0] === 'channels' && parts[1] && parts[2] === 'emojis' && method === 'GET') {
    return listEmojisForChannel(env, user, parts[1]);
  }

  if (parts[0] === 'users' && parts[1] && method === 'GET') return publicProfile(env, parts[1]);
  if (parts[0] === 'me' && parts[1] === 'profile' && method === 'PATCH') return updateProfile(request, env, user);
  if (parts[0] === 'me' && parts[1] === 'avatar' && method === 'POST') return setProfileImage(request, env, user, 'avatar');
  if (parts[0] === 'me' && parts[1] === 'banner' && method === 'POST') return setProfileImage(request, env, user, 'banner');

  if (parts[0] === 'bots') {
    if (!parts[1] && method === 'GET') return listBots(env, user);
    if (!parts[1] && method === 'POST') return createBot(request, env, user);
    if (parts[1] && !parts[2] && method === 'PATCH') return updateBot(request, env, user, parts[1]);
    if (parts[1] && parts[2] === 'token' && method === 'POST') return rotateBotToken(env, user, parts[1]);
    if (parts[1] && parts[2] === 'avatar' && method === 'POST') return setBotAvatar(request, env, user, parts[1]);
    if (parts[1] && parts[2] === 'commands' && !parts[3] && method === 'POST') return addBotCommand(request, env, user, parts[1]);
    if (parts[1] && parts[2] === 'commands' && parts[3] && method === 'DELETE') return deleteBotCommand(env, user, parts[1], parts[3]);
  }

  if (parts[0] === 'servers' && parts[1] && parts[2] === 'bots' && method === 'POST') {
    return addBotToServer(request, env, user, parts[1]);
  }
  if (parts[0] === 'servers' && parts[1] && parts[2] === 'emojis') {
    if (parts[3] === 'upload' && method === 'POST') return uploadEmojiFile(request, env, user, parts[1]);
    if (!parts[3] && method === 'POST') return createEmoji(request, env, user, parts[1]);
  }
  if (parts[0] === 'emojis' && parts[1] && method === 'DELETE') return deleteEmoji(env, user, parts[1]);

  if (parts[0] === 'invites' && parts[1] && method === 'GET') return previewInvite(env, user, parts[1]);
  if (parts[0] === 'invites' && parts[1] && method === 'DELETE') return revokeInvite(env, user, parts[1]);
  if (parts[0] === 'servers' && parts[1] === 'join' && method === 'POST') return joinWithInvite(request, env, user);
  if (parts[0] === 'servers' && parts[1] && parts[2] === 'invites') {
    if (!parts[3] && method === 'GET') return listInvites(env, user, parts[1]);
    if (!parts[3] && method === 'POST') return createInvite(request, env, user, parts[1]);
  }
  if (parts[0] === 'files' && parts[1] && method === 'GET') return serveAnyFile(env, user, parts[1]);

  // Server icon (owner only)
  if (parts[0] === 'servers' && parts[1] && parts[2] === 'icon' && method === 'POST') {
    return setServerIcon(request, env, user, parts[1]);
  }

  // Friends
  if (parts[0] === 'friends') {
    if (!parts[1] && method === 'GET') return listFriends(env, user);
    if (!parts[1] && method === 'POST') return sendFriendRequest(request, env, user);
    if (parts[1] && parts[2] === 'accept' && method === 'POST') return respondFriend(env, user, parts[1], 'accepted');
    if (parts[1] && parts[2] === 'decline' && method === 'POST') return respondFriend(env, user, parts[1], 'declined');
    if (parts[1] && method === 'DELETE') return removeFriend(env, user, parts[1]);
  }

  // Platform owner: badges, sanctions, verified color
  if (parts[0] === 'admin') {
    if (parts[1] === 'badges' && !parts[2] && method === 'GET') return listBadges(env, user);
    if (parts[1] === 'badges' && !parts[2] && method === 'POST') return createBadge(request, env, user);
    if (parts[1] === 'badges' && parts[2] && method === 'DELETE') return deleteBadge(env, user, parts[2]);
    if (parts[1] === 'grant-badge' && method === 'POST') return grantBadge(request, env, user);
    if (parts[1] === 'revoke-badge' && method === 'POST') return revokeBadge(request, env, user);
    if (parts[1] === 'sanction' && method === 'POST') return createSanction(request, env, user);
    if (parts[1] === 'unsanction' && method === 'POST') return liftSanction(request, env, user);
    if (parts[1] === 'sanctions' && method === 'GET') return listSanctions(env, user);
    if (parts[1] === 'verified-color' && method === 'PATCH') return setVerifiedColor(request, env, user);
    if (parts[1] === 'bootstrap-owner' && method === 'POST') return claimOwner(request, env, user);
  }

  // DMs
  if (parts[0] === 'dms') {
    if (!parts[1] && method === 'GET') return listDms(env, user);
    if (!parts[1] && method === 'POST') return openDm(request, env, user);
    if (parts[1] && parts[2] === 'messages' && method === 'GET') return listDmMessages(url, env, user, parts[1]);
    if (parts[1] && parts[2] === 'messages' && method === 'POST') return postDmMessage(request, env, user, parts[1]);
  }

  return null;
}

// Runs after a user message is saved. Bots answer @mentions and /commands in the same server.
// XKiro (mode === 'ai'): continuous natural conversation when the bot is @mentioned.
export async function respondToMessage({ env, serverId, channelId, author, content, messageId }) {
  // Never let bots trigger other bots (avoids loops).
  if (author?.bot) return;

  const { results: bots } = await env.DB.prepare(
    `SELECT u.id, u.username, b.mode, b.prompt, b.default_reply
     FROM server_members m
     JOIN users u ON u.id = m.user_id
     JOIN bots b ON b.user_id = u.id
     WHERE m.server_id = ?`
  ).bind(serverId).all();
  if (!bots.length) return;

  const text = String(content || '').trim();
  let bot = null;
  let command = null;
  let mentionOnly = false;

  // Slash commands: /name args — matches a bot_commands row for any bot in the server.
  if (text.startsWith('/')) {
    const [rawName, ...rest] = text.slice(1).split(/\s+/);
    const name = rawName.toLowerCase();

    // Built-in /help — lists commands of bots in this server.
    if (name === 'help' && bots.length) {
      const lines = [];
      for (const candidate of bots) {
        const { results: cmds } = await env.DB.prepare(
          'SELECT name, response FROM bot_commands WHERE bot_id = ? ORDER BY name'
        ).bind(candidate.id).all();
        if (!cmds.length) {
          lines.push('@' + candidate.username + ' — no custom commands' + (candidate.mode === 'ai' ? ' · AI on' : ''));
          continue;
        }
        lines.push('@' + candidate.username);
        for (const c of cmds) {
          lines.push('  /' + c.name + ' — ' + String(c.response).slice(0, 80));
        }
      }
      await env.DB.prepare(
        'INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?)'
      ).bind(channelId, bots[0].id, lines.join('\n').slice(0, MAX_MESSAGE_CHARS), Date.now()).run();
      return;
    }

    for (const candidate of bots) {
      const row = await env.DB.prepare('SELECT response FROM bot_commands WHERE bot_id = ? AND name = ?')
        .bind(candidate.id, name).first();
      if (row) {
        bot = candidate;
        command = { response: row.response, args: rest.join(' ') };
        break;
      }
    }
  }

  // @mention: prefer exact token "@username" (word boundary), not loose includes.
  if (!bot) {
    const mentionRe = /(?:^|[\s([{])@([A-Za-z0-9_.-]{3,24})\b/g;
    let match;
    const mentioned = new Set();
    while ((match = mentionRe.exec(text)) !== null) {
      mentioned.add(match[1].toLowerCase());
    }
    bot = bots.find((candidate) => mentioned.has(candidate.username.toLowerCase())) || null;
    if (bot) mentionOnly = true;
  }

  if (!bot) return;

  await setTyping(env, channelId, bot.id);
  try {
    let reply = null;
    if (command) {
      reply = fillTemplate(command.response, {
        user: author.displayName || author.username,
        args: command.args,
        bot: bot.username,
      });
    } else if (bot.mode === 'ai') {
      // Natural conversation via XKiro when the bot is @mentioned.
      reply = await askXkiro(env, bot, channelId, messageId, author);
      if (!reply) {
        // Distinguish missing key vs API failure so the owner can debug.
        const key = String(env.XKIRO_API_KEY || '').trim();
        const base = String(env.XKIRO_BASE_URL || '').trim();
        if (!key || !base) {
          reply = bot.default_reply
            || `(${bot.username}) AI is offline — set XKIRO_API_KEY on the Worker.`;
        } else {
          reply = bot.default_reply
            || `(${bot.username}) Could not reach XKiro right now. Try again in a moment.`;
        }
      }
    } else if (mentionOnly) {
      // Standard (canned) bot: reply with default or a short greeting.
      reply = bot.default_reply || `Hi @${author.username}, I'm ${bot.username}.`;
    }

    if (!reply) return;

    await env.DB.prepare(
      'INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?)'
    ).bind(channelId, bot.id, String(reply).slice(0, MAX_MESSAGE_CHARS), Date.now()).run();
  } finally {
    await env.DB.prepare('DELETE FROM typing WHERE channel_id = ? AND user_id = ?')
      .bind(channelId, bot.id).run();
  }
}

function fillTemplate(template, values) {
  return String(template).replace(/\{(user|args|bot)\}/g, (_, key) => values[key] ?? '');
}

/**
 * XKiro chat completions (OpenAI-compatible).
 * Uses recent channel history so the bot keeps context across turns.
 * Credentials stay on the Worker (XKIRO_API_KEY secret) — never sent to the browser.
 */
async function askXkiro(env, bot, channelId, messageId, author) {
  const key = String(env.XKIRO_API_KEY || '').trim();
  const base = String(env.XKIRO_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!key || !base) return null;

  const { results } = await env.DB.prepare(
    `SELECT m.content, u.username, u.is_bot, u.id AS author_id
     FROM messages m JOIN users u ON u.id = m.author_id
     WHERE m.channel_id = ? AND m.deleted = 0 AND m.id <= ?
     ORDER BY m.id DESC LIMIT ?`
  ).bind(channelId, messageId, BOT_HISTORY).all();

  // Build OpenAI-style history. Prefer messages that involve this bot or the current user
  // so multi-bot channels don't pollute context as much.
  const reversed = results.reverse();
  const history = [];
  for (const m of reversed) {
    const isThisBot = m.author_id === bot.id || (m.is_bot && m.username === bot.username);
    let content = String(m.content || '').trim();
    // Strip @BotName from user messages so the model focuses on the question.
    if (!isThisBot) {
      content = content.replace(new RegExp(`@${bot.username}\\b`, 'gi'), '').trim() || content;
    }
    if (!content) continue;
    history.push({
      role: isThisBot ? 'assistant' : 'user',
      content: isThisBot ? content : `${m.username}: ${content}`,
    });
  }

  const system = [
    `You are ${bot.username}, a helpful bot inside Hellcord (a Discord-like chat).`,
    bot.prompt || 'Be friendly, concise, and useful.',
    `You are talking with ${author?.displayName || author?.username || 'a user'}.`,
    'Reply in the same language as the latest user message.',
    'Do not pretend to be a human. Keep answers under 900 characters unless the user asks for detail.',
    'Do not invent that you have tools, files, or private data you do not have.',
  ].join(' ');

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.XKIRO_BOT_MODEL || 'qwen/qwen3.8-max:free',
        messages: [{ role: 'system', content: system }, ...history],
        temperature: 0.7,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('xkiro status', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return null;
    return text.trim().slice(0, MAX_MESSAGE_CHARS);
  } catch (err) {
    console.error('xkiro error', String(err?.message || err).slice(0, 200));
    return null;
  }
}

// ---------- messages ----------

async function editMessage(request, env, user, messageId) {
  const body = await readJson(request);
  const content = String(body.content ?? '').trim();
  if (!content || content.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, `Messages are 1 to ${MAX_MESSAGE_CHARS} characters.`);
  }
  const row = await env.DB.prepare('SELECT id, author_id FROM messages WHERE id = ? AND deleted = 0').bind(messageId).first();
  if (!row) throw new HttpError(404, 'Message not found.');
  if (row.author_id !== user.id) throw new HttpError(403, 'You can only edit your own messages.');
  const now = Date.now();
  await env.DB.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').bind(content, now, messageId).run();
  return json({ message: { id: Number(messageId), content, edited_at: now } });
}

async function setTyping(env, channelId, userId) {
  await env.DB.prepare('DELETE FROM typing WHERE updated_at < ?').bind(Date.now() - 60000).run();
  await env.DB.prepare(
    `INSERT INTO typing (channel_id, user_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (channel_id, user_id) DO UPDATE SET updated_at = excluded.updated_at`
  ).bind(channelId, userId, Date.now()).run();
}

async function memberOfChannel(env, channelId, userId) {
  const row = await env.DB.prepare(
    `SELECT c.server_id FROM channels c JOIN server_members m ON m.server_id = c.server_id
     WHERE c.id = ? AND m.user_id = ?`
  ).bind(channelId, userId).first();
  if (!row) throw new HttpError(404, 'Channel not found.');
  return row;
}

async function listTyping(env, user, channelId) {
  await memberOfChannel(env, channelId, user.id);
  const { results } = await env.DB.prepare(
    `SELECT u.username, u.is_bot FROM typing t JOIN users u ON u.id = t.user_id
     WHERE t.channel_id = ? AND t.user_id != ? AND t.updated_at > ?`
  ).bind(channelId, user.id, Date.now() - TYPING_MS).all();
  return json({ typing: results.map((r) => ({ username: r.username, bot: Boolean(r.is_bot) })) });
}

async function setTypingRoute(env, user, channelId) {
  await memberOfChannel(env, channelId, user.id);
  await setTyping(env, channelId, user.id);
  return json({ ok: true });
}

// ---------- profiles ----------

async function publicProfile(env, userId) {
  const row = await env.DB.prepare(
    `SELECT id, username, display_name, bio, avatar_file_id, banner_file_id, banner_color, frame, nitro, is_bot, created_at,
            is_platform_owner, verified, verified_color, status, custom_status
     FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!row) throw new HttpError(404, 'User not found.');
  let badges = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT b.id, b.name, b.icon, b.color, b.description
       FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
       WHERE ub.user_id = ? ORDER BY ub.granted_at`
    ).bind(userId).all();
    badges = results || [];
  } catch (_) { /* table may not exist yet */ }
  const isOwner = Boolean(row.is_platform_owner);
  return json({
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name || row.username,
      bio: row.bio,
      avatar: row.avatar_file_id || null,
      banner: row.banner_file_id || null,
      bannerColor: row.banner_color,
      frame: row.frame,
      nitro: Boolean(row.nitro),
      bot: Boolean(row.is_bot),
      createdAt: row.created_at,
      platformOwner: isOwner,
      verified: Boolean(row.verified) || isOwner,
      verifiedColor: row.verified_color || '#3b82f6',
      status: row.status || 'online',
      customStatus: row.custom_status || '',
      badges,
    },
  });
}

async function updateProfile(request, env, user) {
  const body = await readJson(request);
  const bio = String(body.bio ?? '').trim();
  const bannerColor = String(body.bannerColor ?? '#e11d2e');
  const frame = String(body.frame ?? 'none');
  let displayName = String(body.displayName ?? body.display_name ?? '').trim();
  if (displayName.length > 32) throw new HttpError(400, 'Display name is at most 32 characters.');
  if (bio.length > 190) throw new HttpError(400, 'Bio is at most 190 characters.');
  if (!/^#[0-9a-fA-F]{6}$/.test(bannerColor)) throw new HttpError(400, 'Banner color must look like #e11d2e.');
  if (!FRAMES.has(frame)) throw new HttpError(400, 'Unknown frame.');
  // Always update against the authenticated session user — never trust a client-supplied user id.
  await env.DB.prepare('UPDATE users SET bio = ?, banner_color = ?, frame = ?, display_name = ? WHERE id = ?')
    .bind(bio, bannerColor, frame, displayName, user.id)
    .run();
  return json({ ok: true, displayName: displayName || null });
}

// Stores an image for a profile field, keeps the old one out of storage.
async function saveImage(request, env, user, purpose, maxBytes) {
  if (!b2Config(env).configured) throw new HttpError(503, b2Problem(env));
  const mime = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw new HttpError(415, 'Use a PNG, JPEG, GIF or WebP image.');
  if (Number(request.headers.get('Content-Length') || 0) > maxBytes) throw new HttpError(413, 'That image is too large.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new HttpError(413, 'That image is too large.');

  const id = crypto.randomUUID();
  const storageKey = `hellcord/${id}`;
  const name = `${purpose}.${mime.split('/')[1]}`;
  await b2Put(env, storageKey, bytes, mime);
  await env.DB.prepare(
    `INSERT INTO files (id, owner_id, channel_id, storage_key, name, mime, size, created_at, purpose)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, storageKey, name, mime, bytes.byteLength, Date.now(), purpose).run();
  return { id, mime, size: bytes.byteLength };
}

async function dropFile(env, fileId) {
  if (!fileId) return;
  const file = await env.DB.prepare('SELECT storage_key FROM files WHERE id = ?').bind(fileId).first();
  if (!file) return;
  if (b2Config(env).configured) await b2Delete(env, file.storage_key).catch(() => {});
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();
}

async function setProfileImage(request, env, user, purpose) {
  const column = purpose === 'avatar' ? 'avatar_file_id' : 'banner_file_id';
  const current = await env.DB.prepare(`SELECT ${column} AS id FROM users WHERE id = ?`).bind(user.id).first();
  const saved = await saveImage(request, env, user, purpose, PROFILE_IMAGE_BYTES);
  await env.DB.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).bind(saved.id, user.id).run();
  await dropFile(env, current?.id);
  return json({ file: { id: saved.id } }, 201);
}

// ---------- bots ----------

async function ownedBot(env, user, botId) {
  const bot = await env.DB.prepare(
    `SELECT b.user_id, b.mode, b.prompt, b.default_reply, u.username, u.avatar_file_id
     FROM bots b JOIN users u ON u.id = b.user_id
     WHERE b.user_id = ? AND u.bot_owner_id = ?`
  ).bind(botId, user.id).first();
  if (!bot) throw new HttpError(404, 'Bot not found.');
  return bot;
}

async function botDetails(env, bot) {
  const { results } = await env.DB.prepare('SELECT id, name, response FROM bot_commands WHERE bot_id = ? ORDER BY name')
    .bind(bot.user_id)
    .all();
  return {
    id: bot.user_id,
    username: bot.username,
    mode: bot.mode,
    prompt: bot.prompt,
    defaultReply: bot.default_reply,
    avatar: bot.avatar_file_id || null,
    commands: results,
  };
}

async function listBots(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT b.user_id, b.mode, b.prompt, b.default_reply, u.username, u.avatar_file_id
     FROM bots b JOIN users u ON u.id = b.user_id WHERE u.bot_owner_id = ? ORDER BY u.username`
  ).bind(user.id).all();
  return json({ bots: await Promise.all(results.map((bot) => botDetails(env, bot))) });
}

function botFields(body) {
  const mode = body.mode === 'ai' ? 'ai' : 'canned';
  const prompt = String(body.prompt ?? '').trim().slice(0, 1000);
  const defaultReply = String(body.defaultReply ?? '').trim().slice(0, 500);
  return { mode, prompt, defaultReply };
}

async function createBot(request, env, user) {
  const body = await readJson(request);
  const username = validUsername(body.name);
  if (!username) throw new HttpError(400, 'Bot names: 3 to 24 letters, numbers, dots, dashes or underscores.');
  if (await usernameTaken(env, username)) throw new HttpError(409, 'That name is taken.');
  const { mode, prompt, defaultReply } = botFields(body);
  const id = crypto.randomUUID();
  const token = 'hcb_' + randomToken(32);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, username, password_hash, created_at, is_bot, bot_owner_id) VALUES (?, ?, '!', ?, 1, ?)`
    ).bind(id, username, now, user.id),
    env.DB.prepare(
      `INSERT INTO bots (user_id, token_hash, mode, prompt, default_reply, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, await sha256Hex(token), mode, prompt, defaultReply, now),
  ]);
  return json({ bot: { id, username, mode, prompt, defaultReply, commands: [] }, token }, 201);
}

async function updateBot(request, env, user, botId) {
  const current = await ownedBot(env, user, botId);
  const body = await readJson(request);
  const fields = botFields({
    mode: body.mode ?? current.mode,
    prompt: body.prompt ?? current.prompt,
    defaultReply: body.defaultReply ?? current.default_reply,
  });
  await env.DB.prepare('UPDATE bots SET mode = ?, prompt = ?, default_reply = ? WHERE user_id = ?')
    .bind(fields.mode, fields.prompt, fields.defaultReply, botId)
    .run();
  return json({ ok: true });
}

async function rotateBotToken(env, user, botId) {
  await ownedBot(env, user, botId);
  const token = 'hcb_' + randomToken(32);
  await env.DB.prepare('UPDATE bots SET token_hash = ? WHERE user_id = ?').bind(await sha256Hex(token), botId).run();
  return json({ token });
}

async function setBotAvatar(request, env, user, botId) {
  const bot = await ownedBot(env, user, botId);
  const saved = await saveImage(request, env, { id: botId }, 'avatar', PROFILE_IMAGE_BYTES);
  await env.DB.prepare('UPDATE users SET avatar_file_id = ? WHERE id = ?').bind(saved.id, botId).run();
  await dropFile(env, bot.avatar_file_id);
  return json({ file: { id: saved.id } }, 201);
}

async function addBotCommand(request, env, user, botId) {
  await ownedBot(env, user, botId);
  const body = await readJson(request);
  const name = String(body.name ?? '').trim().toLowerCase();
  const response = String(body.response ?? '').trim();
  if (!/^[a-z0-9_-]{1,24}$/.test(name)) throw new HttpError(400, 'Command names: 1 to 24 letters, numbers, dashes or underscores.');
  if (!response || response.length > 1000) throw new HttpError(400, 'Responses are 1 to 1000 characters. Use {user}, {args} and {bot}.');
  const exists = await env.DB.prepare('SELECT id FROM bot_commands WHERE bot_id = ? AND name = ?').bind(botId, name).first();
  if (exists) throw new HttpError(409, `/${name} already exists.`);
  const result = await env.DB.prepare('INSERT INTO bot_commands (bot_id, name, response) VALUES (?, ?, ?)')
    .bind(botId, name, response)
    .run();
  return json({ command: { id: result.meta.last_row_id, name, response } }, 201);
}

async function deleteBotCommand(env, user, botId, commandId) {
  await ownedBot(env, user, botId);
  await env.DB.prepare('DELETE FROM bot_commands WHERE id = ? AND bot_id = ?').bind(Number(commandId), botId).run();
  return json({ ok: true });
}

async function addBotToServer(request, env, user, serverId) {
  const server = await env.DB.prepare('SELECT owner_id FROM servers WHERE id = ?').bind(serverId).first();
  if (!server || server.owner_id !== user.id) throw new HttpError(403, 'Only the server owner can add bots.');
  const body = await readJson(request);
  const botId = String(body.botId || '');
  await ownedBot(env, user, botId);
  await env.DB.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)')
    .bind(serverId, botId, Date.now())
    .run();
  return json({ ok: true });
}

// ---------- emojis (Nitro can use emojis from every server it belongs to) ----------

async function requireServerMember(env, serverId, userId) {
  const row = await env.DB.prepare('SELECT owner_id FROM servers s JOIN server_members m ON m.server_id = s.id WHERE s.id = ? AND m.user_id = ?')
    .bind(serverId, userId)
    .first();
  if (!row) throw new HttpError(404, 'Server not found.');
  return row;
}

async function uploadEmojiFile(request, env, user, serverId) {
  await requireServerMember(env, serverId, user.id);
  const saved = await saveImage(request, env, user, 'emoji', EMOJI_BYTES);
  return json({ file: { id: saved.id } }, 201);
}

async function createEmoji(request, env, user, serverId) {
  await requireServerMember(env, serverId, user.id);
  const body = await readJson(request);
  const name = String(body.name ?? '').trim().toLowerCase();
  const fileId = String(body.fileId ?? '');
  if (!/^[a-z0-9_]{2,32}$/.test(name)) throw new HttpError(400, 'Emoji names: 2 to 32 letters, numbers or underscores.');
  const file = await env.DB.prepare("SELECT id FROM files WHERE id = ? AND owner_id = ? AND purpose = 'emoji'")
    .bind(fileId, user.id)
    .first();
  if (!file) throw new HttpError(400, 'Upload the emoji image first.');
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare('INSERT INTO emojis (id, server_id, name, file_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, serverId, name, fileId, Date.now())
      .run();
  } catch {
    throw new HttpError(409, `:${name}: already exists on this server.`);
  }
  return json({ emoji: { id, name, serverId, fileId } }, 201);
}

async function listEmojisForChannel(env, user, channelId) {
  const channel = await memberOfChannel(env, channelId, user.id);
  const me = await env.DB.prepare('SELECT nitro FROM users WHERE id = ?').bind(user.id).first();
  const { results } = me && me.nitro
    ? await env.DB.prepare(
        `SELECT e.id, e.name, e.server_id, s.name AS server_name, e.file_id
         FROM emojis e
         JOIN servers s ON s.id = e.server_id
         JOIN server_members m ON m.server_id = e.server_id
         WHERE m.user_id = ? ORDER BY e.name`
      ).bind(user.id).all()
    : await env.DB.prepare(
        `SELECT e.id, e.name, e.server_id, s.name AS server_name, e.file_id
         FROM emojis e JOIN servers s ON s.id = e.server_id
         WHERE e.server_id = ? ORDER BY e.name`
      ).bind(channel.server_id).all();
  return json({
    emojis: results.map((e) => ({
      id: e.id, name: e.name, serverId: e.server_id, serverName: e.server_name, fileId: e.file_id,
    })),
    nitro: Boolean(me && me.nitro),
  });
}

async function deleteEmoji(env, user, emojiId) {
  const row = await env.DB.prepare(
    `SELECT e.id, e.file_id, s.owner_id FROM emojis e JOIN servers s ON s.id = e.server_id WHERE e.id = ?`
  ).bind(emojiId).first();
  if (!row) throw new HttpError(404, 'Emoji not found.');
  if (row.owner_id !== user.id) throw new HttpError(403, 'Only the server owner can delete emojis.');
  await env.DB.prepare('DELETE FROM emojis WHERE id = ?').bind(emojiId).run();
  await dropFile(env, row.file_id);
  return json({ ok: true });
}

// ---------- files ----------

// Profile images and emojis are public to signed-in users. Chat attachments need channel membership.
async function serveAnyFile(env, user, fileId) {
  const file = await env.DB.prepare('SELECT storage_key, name, mime, purpose FROM files WHERE id = ?').bind(fileId).first();
  if (!file) throw new HttpError(404, 'File not found.');
  if (file.purpose === 'attachment') {
    const member = await env.DB.prepare(
      `SELECT 1 AS ok FROM files f
       JOIN channels c ON c.id = f.channel_id
       JOIN server_members m ON m.server_id = c.server_id
       WHERE f.id = ? AND m.user_id = ?`
    ).bind(fileId, user.id).first();
    if (!member) throw new HttpError(404, 'File not found.');
  }
  if (!b2Config(env).configured) throw new HttpError(503, b2Problem(env));
  const object = await b2Get(env, file.storage_key);
  if (!object) throw new HttpError(404, 'File not found.');
  const purpose = String(file.purpose || 'attachment');
  // Profile/banner/emoji/server icons: always inline, no "download as attachment" hint.
  // Chat attachments keep normal behavior (images can still be saved by the user).
  const isProfileAsset = /^(avatar|banner|emoji|server_icon)$/i.test(purpose);
  const isMedia = /^(image|audio|video)\//.test(file.mime);
  const disposition = isProfileAsset || isMedia ? 'inline' : 'attachment';
  const ascii = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const headers = {
    'Content-Type': file.mime,
    'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': isProfileAsset ? 'private, max-age=86400' : 'private, max-age=3600',
    ...SECURITY_HEADERS,
  };
  // Discourage drive-by download of profile images (browsers still may allow Save As).
  if (isProfileAsset) {
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; media-src 'self'";
  }
  return new Response(object.body, { headers });
}

// ---------- invites ----------

const INVITE_HOURS = new Set([1, 24, 168]);
const INVITE_USES = new Set([1, 5, 10, 50]);
const INVITE_STATUS_MESSAGES = {
  revoked: 'This invite was revoked.',
  expired: 'This invite has expired.',
  'used-up': 'This invite has no uses left.',
};

function inviteStatus(row, now) {
  if (row.revoked) return 'revoked';
  if (row.expires_at && row.expires_at <= now) return 'expired';
  if (row.max_uses !== null && row.max_uses !== undefined && row.uses >= row.max_uses) return 'used-up';
  return 'active';
}

// Looks up a managed invite first, then the permanent code each server was created with.
async function resolveInvite(env, code) {
  const row = await env.DB.prepare(
    `SELECT i.code, i.server_id, i.max_uses, i.uses, i.expires_at, i.revoked, i.created_by,
            s.name AS server_name, s.owner_id
     FROM invites i JOIN servers s ON s.id = i.server_id WHERE i.code = ?`
  ).bind(code).first();
  if (row) return { ...row, legacy: false };
  const legacy = await env.DB.prepare(
    'SELECT id AS server_id, name AS server_name, owner_id, invite_code AS code FROM servers WHERE invite_code = ?'
  ).bind(code).first();
  if (legacy) {
    return { ...legacy, max_uses: null, uses: 0, expires_at: null, revoked: 0, created_by: legacy.owner_id, legacy: true };
  }
  return null;
}

async function memberCount(env, serverId) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM server_members WHERE server_id = ?').bind(serverId).first();
  return Number(row?.n || 0);
}

async function isMember(env, serverId, userId) {
  return Boolean(await env.DB.prepare('SELECT 1 AS ok FROM server_members WHERE server_id = ? AND user_id = ?')
    .bind(serverId, userId).first());
}

async function previewInvite(env, user, code) {
  const invite = await resolveInvite(env, code);
  if (!invite) throw new HttpError(404, 'That invite does not exist.');
  return json({
    invite: {
      code: invite.code,
      serverId: invite.server_id,
      serverName: invite.server_name,
      members: await memberCount(env, invite.server_id),
      status: inviteStatus(invite, Date.now()),
      joined: await isMember(env, invite.server_id, user.id),
      expiresAt: invite.expires_at || null,
      maxUses: invite.max_uses ?? null,
      uses: invite.uses || 0,
      legacy: invite.legacy,
    },
  });
}

async function joinWithInvite(request, env, user) {
  const body = await readJson(request);
  const code = String(body.invite || '').trim();
  const invite = await resolveInvite(env, code);
  if (!invite) throw new HttpError(404, 'That invite does not exist.');
  const server = { id: invite.server_id, name: invite.server_name, owner_id: invite.owner_id };
  if (await isMember(env, invite.server_id, user.id)) {
    return json({ server, alreadyMember: true });
  }
  const status = inviteStatus(invite, Date.now());
  if (status !== 'active') throw new HttpError(410, INVITE_STATUS_MESSAGES[status]);
  if (!invite.legacy) {
    // One conditional UPDATE claims a use, so two people cannot take the last one.
    const claimed = await env.DB.prepare(
      `UPDATE invites SET uses = uses + 1
       WHERE code = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)
         AND (max_uses IS NULL OR uses < max_uses)`
    ).bind(code, Date.now()).run();
    if (!claimed.meta.changes) throw new HttpError(410, 'This invite just ran out of uses or expired.');
  }
  await env.DB.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)')
    .bind(invite.server_id, user.id, Date.now())
    .run();
  return json({ server, alreadyMember: false });
}

async function createInvite(request, env, user, serverId) {
  await requireServerMember(env, serverId, user.id);
  const body = await readJson(request);
  const maxUses = Number(body.maxUses) || null;
  const hours = Number(body.expiresInHours) || null;
  if (maxUses !== null && !INVITE_USES.has(maxUses)) throw new HttpError(400, 'Choose 1, 5, 10 or 50 uses, or no limit.');
  if (hours !== null && !INVITE_HOURS.has(hours)) throw new HttpError(400, 'Choose 1 hour, 1 day, 7 days or never.');
  const code = randomToken(6);
  const now = Date.now();
  const expiresAt = hours ? now + hours * 3600000 : null;
  await env.DB.prepare(
    'INSERT INTO invites (code, server_id, created_by, max_uses, uses, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?, 0, ?)'
  ).bind(code, serverId, user.id, maxUses, expiresAt, now).run();
  return json({ invite: { code, maxUses, uses: 0, expiresAt, status: 'active' } }, 201);
}

async function listInvites(env, user, serverId) {
  await requireServerMember(env, serverId, user.id);
  const { results } = await env.DB.prepare(
    `SELECT i.code, i.max_uses, i.uses, i.expires_at, i.revoked, i.created_by, u.username AS created_by_name
     FROM invites i JOIN users u ON u.id = i.created_by
     WHERE i.server_id = ? ORDER BY i.created_at DESC LIMIT 50`
  ).bind(serverId).all();
  const now = Date.now();
  const server = await env.DB.prepare('SELECT invite_code FROM servers WHERE id = ?').bind(serverId).first();
  const invites = results.map((r) => ({
    code: r.code,
    status: inviteStatus(r, now),
    maxUses: r.max_uses ?? null,
    uses: r.uses,
    expiresAt: r.expires_at || null,
    createdBy: r.created_by_name,
    mine: r.created_by === user.id,
    legacy: false,
  }));
  invites.push({
    code: server.invite_code, status: 'active', maxUses: null, uses: 0, expiresAt: null,
    createdBy: 'Server setup', mine: false, legacy: true,
  });
  return json({ invites });
}

async function revokeInvite(env, user, code) {
  const row = await env.DB.prepare(
    `SELECT i.code, i.created_by, s.owner_id FROM invites i JOIN servers s ON s.id = i.server_id WHERE i.code = ?`
  ).bind(code).first();
  if (!row) throw new HttpError(404, 'That invite does not exist.');
  if (row.created_by !== user.id && row.owner_id !== user.id) {
    throw new HttpError(403, 'Only the creator or the server owner can revoke this invite.');
  }
  await env.DB.prepare('UPDATE invites SET revoked = 1 WHERE code = ?').bind(code).run();
  return json({ ok: true });
}

// ---------- server icon ----------

async function setServerIcon(request, env, user, serverId) {
  const server = await env.DB.prepare('SELECT owner_id, icon_file_id FROM servers WHERE id = ?').bind(serverId).first();
  if (!server) throw new HttpError(404, 'Server not found.');
  if (server.owner_id !== user.id) throw new HttpError(403, 'Only the owner can change the server icon.');
  const membership = await env.DB.prepare(
    'SELECT 1 AS ok FROM server_members WHERE server_id = ? AND user_id = ?'
  ).bind(serverId, user.id).first();
  if (!membership) throw new HttpError(404, 'Server not found.');
  const saved = await saveImage(request, env, user, 'server_icon', PROFILE_IMAGE_BYTES);
  await env.DB.prepare('UPDATE servers SET icon_file_id = ? WHERE id = ?').bind(saved.id, serverId).run();
  if (server.icon_file_id) await dropFile(env, server.icon_file_id);
  return json({ icon: saved.id });
}

// ---------- friends ----------

function pairIds(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function listFriends(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.status, f.requested_by, f.user_a, f.user_b, f.created_at,
            ua.username AS a_username, ua.display_name AS a_display, ua.avatar_file_id AS a_avatar, ua.frame AS a_frame,
            ub.username AS b_username, ub.display_name AS b_display, ub.avatar_file_id AS b_avatar, ub.frame AS b_frame
     FROM friendships f
     JOIN users ua ON ua.id = f.user_a
     JOIN users ub ON ub.id = f.user_b
     WHERE (f.user_a = ? OR f.user_b = ?) AND f.status IN ('pending', 'accepted')
     ORDER BY f.updated_at DESC`
  ).bind(user.id, user.id).all();
  const friends = results.map((row) => {
    const otherIsA = row.user_b === user.id;
    return {
      id: row.id,
      status: row.status,
      incoming: row.status === 'pending' && row.requested_by !== user.id,
      outgoing: row.status === 'pending' && row.requested_by === user.id,
      user: {
        id: otherIsA ? row.user_a : row.user_b,
        username: otherIsA ? row.a_username : row.b_username,
        displayName: (otherIsA ? row.a_display : row.b_display) || (otherIsA ? row.a_username : row.b_username),
        avatar: (otherIsA ? row.a_avatar : row.b_avatar) || null,
        frame: (otherIsA ? row.a_frame : row.b_frame) || 'none',
      },
    };
  });
  return json({ friends });
}

async function sendFriendRequest(request, env, user) {
  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const targetId = body.userId ? String(body.userId) : null;
  let target;
  if (targetId) {
    target = await env.DB.prepare('SELECT id, username FROM users WHERE id = ? AND is_bot = 0').bind(targetId).first();
  } else if (username) {
    target = await env.DB.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE AND is_bot = 0')
      .bind(username).first();
  }
  if (!target) throw new HttpError(404, 'User not found.');
  if (target.id === user.id) throw new HttpError(400, 'You cannot friend yourself.');
  const blocked = await env.DB.prepare(
    'SELECT 1 AS ok FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
  ).bind(user.id, target.id, target.id, user.id).first();
  if (blocked) throw new HttpError(403, 'Cannot send friend request.');
  const [a, b] = pairIds(user.id, target.id);
  const existing = await env.DB.prepare('SELECT id, status FROM friendships WHERE user_a = ? AND user_b = ?')
    .bind(a, b).first();
  if (existing) {
    if (existing.status === 'accepted') throw new HttpError(409, 'You are already friends.');
    if (existing.status === 'pending') throw new HttpError(409, 'Friend request already pending.');
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO friendships (id, user_a, user_b, status, requested_by, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(id, a, b, user.id, now, now).run();
  return json({ friendship: { id, status: 'pending', userId: target.id } }, 201);
}

async function respondFriend(env, user, friendshipId, status) {
  const row = await env.DB.prepare(
    'SELECT id, user_a, user_b, status, requested_by FROM friendships WHERE id = ?'
  ).bind(friendshipId).first();
  if (!row) throw new HttpError(404, 'Request not found.');
  if (row.user_a !== user.id && row.user_b !== user.id) throw new HttpError(403, 'Not your request.');
  if (row.status !== 'pending') throw new HttpError(400, 'Request is not pending.');
  if (status === 'accepted' && row.requested_by === user.id) {
    throw new HttpError(400, 'You cannot accept your own request.');
  }
  const now = Date.now();
  if (status === 'declined') {
    await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(friendshipId).run();
    return json({ ok: true });
  }
  await env.DB.prepare('UPDATE friendships SET status = ?, updated_at = ? WHERE id = ?')
    .bind('accepted', now, friendshipId).run();
  return json({ ok: true, status: 'accepted' });
}

async function removeFriend(env, user, friendshipId) {
  const row = await env.DB.prepare(
    'SELECT id, user_a, user_b FROM friendships WHERE id = ?'
  ).bind(friendshipId).first();
  if (!row) throw new HttpError(404, 'Friendship not found.');
  if (row.user_a !== user.id && row.user_b !== user.id) throw new HttpError(403, 'Not your friendship.');
  await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(friendshipId).run();
  return json({ ok: true });
}

// ---------- DMs ----------

async function listDms(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.last_message_at, d.user_a, d.user_b,
            ua.username AS a_username, ua.display_name AS a_display, ua.avatar_file_id AS a_avatar,
            ub.username AS b_username, ub.display_name AS b_display, ub.avatar_file_id AS b_avatar
     FROM dm_channels d
     JOIN users ua ON ua.id = d.user_a
     JOIN users ub ON ub.id = d.user_b
     WHERE d.user_a = ? OR d.user_b = ?
     ORDER BY COALESCE(d.last_message_at, d.created_at) DESC`
  ).bind(user.id, user.id).all();
  return json({
    dms: results.map((row) => {
      const otherIsA = row.user_b === user.id;
      return {
        id: row.id,
        lastMessageAt: row.last_message_at,
        user: {
          id: otherIsA ? row.user_a : row.user_b,
          username: otherIsA ? row.a_username : row.b_username,
          displayName: (otherIsA ? row.a_display : row.b_display) || (otherIsA ? row.a_username : row.b_username),
          avatar: (otherIsA ? row.a_avatar : row.b_avatar) || null,
        },
      };
    }),
  });
}

async function openDm(request, env, user) {
  const body = await readJson(request);
  const targetId = String(body.userId || '');
  if (!targetId) throw new HttpError(400, 'userId is required.');
  if (targetId === user.id) throw new HttpError(400, 'Cannot DM yourself.');
  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND is_bot = 0').bind(targetId).first();
  if (!target) throw new HttpError(404, 'User not found.');
  const blocked = await env.DB.prepare(
    'SELECT 1 AS ok FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
  ).bind(user.id, targetId, targetId, user.id).first();
  if (blocked) throw new HttpError(403, 'Cannot message this user.');
  const [a, b] = pairIds(user.id, targetId);
  let row = await env.DB.prepare('SELECT id FROM dm_channels WHERE user_a = ? AND user_b = ?').bind(a, b).first();
  if (!row) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO dm_channels (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)'
    ).bind(id, a, b, Date.now()).run();
    row = { id };
  }
  return json({ dm: { id: row.id } });
}

async function assertDmMember(env, dmId, userId) {
  const row = await env.DB.prepare(
    'SELECT id, user_a, user_b FROM dm_channels WHERE id = ?'
  ).bind(dmId).first();
  if (!row || (row.user_a !== userId && row.user_b !== userId)) {
    throw new HttpError(404, 'Conversation not found.');
  }
  return row;
}

async function listDmMessages(url, env, user, dmId) {
  await assertDmMember(env, dmId, user.id);
  const after = Number(url.searchParams.get('after') || 0);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.content, m.created_at, m.edited_at, m.author_id, m.file_id,
            u.username, u.display_name, u.avatar_file_id, u.frame
     FROM dm_messages m JOIN users u ON u.id = m.author_id
     WHERE m.dm_channel_id = ? AND m.deleted = 0 AND m.id > ?
     ORDER BY m.id ASC LIMIT 100`
  ).bind(dmId, after).all();
  return json({
    messages: results.map((row) => ({
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      edited_at: row.edited_at,
      author: {
        id: row.author_id,
        username: row.username,
        displayName: row.display_name || row.username,
        avatar: row.avatar_file_id || null,
        frame: row.frame || 'none',
      },
      file: row.file_id ? { id: row.file_id } : null,
    })),
  });
}

async function postDmMessage(request, env, user, dmId) {
  await assertDmMember(env, dmId, user.id);
  const body = await readJson(request);
  const content = String(body.content || '').trim();
  if (!content || content.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, `Messages are 1 to ${MAX_MESSAGE_CHARS} characters.`);
  }
  const now = Date.now();
  const result = await env.DB.prepare(
    'INSERT INTO dm_messages (dm_channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?)'
  ).bind(dmId, user.id, content, now).run();
  await env.DB.prepare('UPDATE dm_channels SET last_message_at = ? WHERE id = ?').bind(now, dmId).run();
  return json({
    message: {
      id: result.meta.last_row_id,
      content,
      created_at: now,
      author: { id: user.id, username: user.username, displayName: user.displayName || user.username },
    },
  }, 201);
}

// ---------- platform owner / badges / sanctions ----------


// The owner is the account whose database flag is set. Usernames are never trusted.
async function requirePlatformOwner(env, user) {
  const row = await env.DB.prepare('SELECT id, username, is_platform_owner FROM users WHERE id = ?').bind(user.id).first();
  if (!row || !row.is_platform_owner) throw new HttpError(403, 'Only the Hellcord owner can do that.');
  return row;
}

export async function assertNotSanctioned(env, userId) {
  try {
    const row = await env.DB.prepare(
      `SELECT type, reason, expires_at FROM platform_sanctions
       WHERE user_id = ? AND active = 1
       ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first();
    if (!row) return;
    if (row.expires_at && row.expires_at < Date.now()) {
      await env.DB.prepare('UPDATE platform_sanctions SET active = 0 WHERE user_id = ? AND active = 1')
        .bind(userId).run();
      return;
    }
    if (row.type === 'ban') {
      throw new HttpError(403, `You are banned from Hellcord.${row.reason ? ' Reason: ' + row.reason : ''}`);
    }
    if (row.type === 'suspend') {
      throw new HttpError(403, `Your account is suspended.${row.reason ? ' Reason: ' + row.reason : ''}`);
    }
  } catch (err) {
    if (err instanceof HttpError || err?.name === 'HttpError') throw err;
    // table missing → ignore
  }
}

// Claims the owner role once. The claimant must present OWNER_BOOTSTRAP_TOKEN (a Worker secret, 32+ chars).
// The claim is one conditional UPDATE, so two people cannot both win. Afterwards there is no route that
// moves, copies or removes the role.
async function claimOwner(request, env, user) {
  const body = await readJson(request);
  const expected = String(env.OWNER_BOOTSTRAP_TOKEN || '');
  if (expected.length < 32) {
    throw new HttpError(503, 'Owner claim is not configured. Set the OWNER_BOOTSTRAP_TOKEN secret (at least 32 characters).');
  }
  if (!constantTimeEqual(String(body.token || ''), expected)) throw new HttpError(403, 'Wrong claim token.');
  const claimed = await env.DB.prepare(
    `UPDATE users SET is_platform_owner = 1, verified = 1
     WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE is_platform_owner = 1)`
  ).bind(user.id).run();
  if (!claimed.meta.changes) throw new HttpError(409, 'The platform owner is already set.');
  return json({ ok: true, platformOwner: true });
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function setVerifiedColor(request, env, user) {
  await requirePlatformOwner(env, user);
  const body = await readJson(request);
  const color = String(body.color || '#3b82f6');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, 'Color must look like #3b82f6.');
  await env.DB.prepare('UPDATE users SET verified_color = ?, verified = 1 WHERE id = ?')
    .bind(color, user.id).run();
  return json({ ok: true, verifiedColor: color });
}

async function listBadges(env, user) {
  await requirePlatformOwner(env, user);
  const { results } = await env.DB.prepare('SELECT * FROM badges ORDER BY created_at DESC').all();
  return json({ badges: results || [] });
}

async function createBadge(request, env, user) {
  await requirePlatformOwner(env, user);
  const body = await readJson(request);
  const name = String(body.name || '').trim().slice(0, 32);
  const icon = String(body.icon || '★').trim().slice(0, 8) || '★';
  const color = String(body.color || '#e11d2e');
  const description = String(body.description || '').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'Badge name required.');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, 'Invalid color.');
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO badges (id, name, icon, color, description, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, icon, color, description, user.id, Date.now()).run();
  return json({ badge: { id, name, icon, color, description } }, 201);
}

async function deleteBadge(env, user, badgeId) {
  await requirePlatformOwner(env, user);
  await env.DB.prepare('DELETE FROM badges WHERE id = ?').bind(badgeId).run();
  return json({ ok: true });
}

async function grantBadge(request, env, user) {
  await requirePlatformOwner(env, user);
  const body = await readJson(request);
  const badgeId = String(body.badgeId || '');
  let targetId = body.userId ? String(body.userId) : null;
  if (!targetId && body.username) {
    const t = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .bind(String(body.username).trim()).first();
    if (!t) throw new HttpError(404, 'User not found.');
    targetId = t.id;
  }
  if (!badgeId || !targetId) throw new HttpError(400, 'badgeId and userId/username required.');
  const badge = await env.DB.prepare('SELECT id FROM badges WHERE id = ?').bind(badgeId).first();
  if (!badge) throw new HttpError(404, 'Badge not found.');
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_badges (user_id, badge_id, granted_by, granted_at) VALUES (?, ?, ?, ?)`
  ).bind(targetId, badgeId, user.id, Date.now()).run();
  return json({ ok: true });
}

async function revokeBadge(request, env, user) {
  await requirePlatformOwner(env, user);
  const body = await readJson(request);
  const badgeId = String(body.badgeId || '');
  let targetId = body.userId ? String(body.userId) : null;
  if (!targetId && body.username) {
    const t = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .bind(String(body.username).trim()).first();
    if (!t) throw new HttpError(404, 'User not found.');
    targetId = t.id;
  }
  if (!badgeId || !targetId) throw new HttpError(400, 'badgeId and userId/username required.');
  await env.DB.prepare('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?')
    .bind(targetId, badgeId).run();
  return json({ ok: true });
}

async function createSanction(request, env, user) {
  await requirePlatformOwner(env, user);
  const body = await readJson(request);
  const type = String(body.type || 'ban').toLowerCase();
  if (!['ban', 'suspend', 'warn'].includes(type)) throw new HttpError(400, 'type must be ban, suspend or warn.');
  let targetId = body.userId ? String(body.userId) : null;
  if (!targetId && body.username) {
    const t = await env.DB.prepare('SELECT id, username, is_platform_owner FROM users WHERE username = ? COLLATE NOCASE')
      .bind(String(body.username).trim()).first();
    if (!t) throw new HttpError(404, 'User not found.');
    targetId = t.id;
    if (t.is_platform_owner) {
      throw new HttpError(403, 'Cannot sanction the platform owner.');
    }
  }
  if (!targetId) throw new HttpError(400, 'userId or username required.');
  if (targetId === user.id) throw new HttpError(400, 'Cannot sanction yourself.');
  const reason = String(body.reason || '').trim().slice(0, 300);
  const days = Number(body.days || 0);
  const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO platform_sanctions (id, user_id, type, reason, created_by, created_at, expires_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, targetId, type, reason, user.id, Date.now(), expiresAt).run();
  // Ban also kills sessions.
  if (type === 'ban' || type === 'suspend') {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
  }
  return json({ ok: true, sanction: { id, type, reason, expiresAt } }, 201);
}

async function liftSanction(request, env, user) {
  await requirePlatformOwner(env, user);
  const body = await readJson(request);
  let targetId = body.userId ? String(body.userId) : null;
  if (!targetId && body.username) {
    const t = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .bind(String(body.username).trim()).first();
    if (!t) throw new HttpError(404, 'User not found.');
    targetId = t.id;
  }
  if (!targetId) throw new HttpError(400, 'userId or username required.');
  await env.DB.prepare('UPDATE platform_sanctions SET active = 0 WHERE user_id = ? AND active = 1')
    .bind(targetId).run();
  return json({ ok: true });
}

async function listSanctions(env, user) {
  await requirePlatformOwner(env, user);
  const { results } = await env.DB.prepare(
    `SELECT s.*, u.username FROM platform_sanctions s
     JOIN users u ON u.id = s.user_id
     WHERE s.active = 1 ORDER BY s.created_at DESC LIMIT 100`
  ).all();
  return json({ sanctions: results || [] });
}
