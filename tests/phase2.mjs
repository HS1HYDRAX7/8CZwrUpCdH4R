import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const file of ['0001_init.sql', '0002_bots_profiles_emojis.sql']) {
  db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
}

function d1() {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const query = {
        sql,
        bind(...values) { params = values; return query; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() {
          const info = stmt.run(...params);
          return { meta: { last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return query;
    },
    async batch(queries) {
      const out = [];
      for (const q of queries) out.push(/^\s*select/i.test(q.sql) ? await q.all() : await q.run());
      return out;
    },
  };
}

const env = { DB: d1(), ASSETS: { fetch: async () => new Response('ok') } };
const envWithB2 = { ...env, B2_KEY_ID: 'x', B2_APPLICATION_KEY: 'y', B2_BUCKET: 'hellcord-files', B2_ENDPOINT: 's3.us-east-005.backblazeb2.com', B2_REGION: 'us-east-005' };
const pending = [];
const ctx = { waitUntil: (promise) => pending.push(promise) };
const settle = async () => { await Promise.all(pending.splice(0)); };

async function call(method, path, { body, cookie, raw, contentType, headers = {}, target = env, auth } = {}) {
  const h = { ...headers };
  if (method !== 'GET') h['X-Requested-With'] = 'Hellcord';
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (contentType) h['Content-Type'] = contentType;
  if (cookie) h.Cookie = cookie;
  if (auth) h.Authorization = auth;
  const init = { method, headers: h };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (raw !== undefined) init.body = raw;
  const res = await worker.fetch(new Request('https://hellcord.test' + path, init), target, ctx);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const ok = (label) => console.log('  ok -', label);

// Setup: two users, one server each
const reg = async (username) => {
  const r = await call('POST', '/api/auth/register', { body: { username, password: 'password123' } });
  return { user: r.data.user, cookie: cookieFrom(r.res) };
};
const alice = await reg('Alice');
const bob = await reg('Bob');
const lab = (await call('POST', '/api/servers', { body: { name: 'Lab' }, cookie: alice.cookie })).data.server;
const labDetails = (await call('GET', `/api/servers/${lab.id}`, { cookie: alice.cookie })).data;
const general = labDetails.channels[0];
await call('POST', '/api/servers/join', { body: { invite: lab.invite_code }, cookie: bob.cookie });
ok('setup: Alice owns Lab, Bob joins it');

// Bots: create, add to server, commands, mention
let bot, botToken;
{
  const created = await call('POST', '/api/bots', {
    body: { name: 'HelperBot', mode: 'canned', defaultReply: 'Hi there!' }, cookie: alice.cookie,
  });
  assert.equal(created.status, 201);
  bot = created.data.bot;
  botToken = created.data.token;
  assert.match(botToken, /^hcb_/);
  ok('create a bot; the token is returned once and starts with hcb_');

  assert.equal((await call('POST', '/api/bots', { body: { name: 'HelperBot' }, cookie: bob.cookie })).status, 409);
  ok('bot names share the username space');

  assert.equal((await call('POST', `/api/servers/${lab.id}/bots`, { body: { botId: bot.id }, cookie: bob.cookie })).status, 403);
  assert.equal((await call('POST', `/api/servers/${lab.id}/bots`, { body: { botId: bot.id }, cookie: alice.cookie })).status, 200);
  ok('only the server owner adds bots, and only bots they own');

  const cmd = await call('POST', `/api/bots/${bot.id}/commands`, { body: { name: 'ping', response: 'pong {user} {args}' }, cookie: alice.cookie });
  assert.equal(cmd.status, 201);
  assert.equal((await call('POST', `/api/bots/${bot.id}/commands`, { body: { name: 'ping', response: 'x' }, cookie: alice.cookie })).status, 409);
  assert.equal((await call('POST', `/api/bots/${bot.id}/commands`, { body: { name: 'Bad Name!', response: 'x' }, cookie: alice.cookie })).status, 400);
  ok('commands are added once, with validated names');

  const before = (await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages.length;
  const posted = await call('POST', `/api/channels/${general.id}/messages`, { body: { content: '/ping hello' }, cookie: bob.cookie });
  assert.equal(posted.status, 201);
  await settle();
  const after = (await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages;
  assert.equal(after.length, before + 2);
  assert.equal(after.at(-1).content, 'pong Bob hello');
  assert.equal(after.at(-1).author.bot, true);
  ok('a /command gets the bot answer, with {user} and {args} filled in');

  await call('POST', `/api/channels/${general.id}/messages`, { body: { content: 'hey @helperbot you there?' }, cookie: bob.cookie });
  await settle();
  const mention = (await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages.at(-1);
  assert.equal(mention.content, 'Hi there!');
  ok('mentioning the bot (any letter case) gets the default reply');

  const quiet = (await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages.length;
  await call('POST', `/api/channels/${general.id}/messages`, { body: { content: 'just chatting' }, cookie: bob.cookie });
  await settle();
  assert.equal((await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages.length, quiet + 1);
  ok('plain messages without a mention or command get no bot reply');

  const bad = await call('GET', `/api/channels/${general.id}/messages`, { auth: 'Bearer hcb_wrong' });
  assert.equal(bad.status, 401);
  ok('a wrong bot token is rejected');

  const botPost = await call('POST', `/api/bot/channels/${general.id}/messages`, { body: { content: '/ping from the api' }, auth: 'Bearer ' + botToken });
  assert.equal(botPost.status, 201);
  assert.equal(botPost.data.message.author.bot, true);
  await settle();
  const afterBot = (await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages;
  assert.equal(afterBot.at(-1).content, '/ping from the api', 'bot messages must not trigger other bots');
  ok('the bot API posts as the bot, and bot messages do not trigger bot replies');

  const history = await call('GET', `/api/bot/channels/${general.id}/messages?after=0`, { auth: 'Bearer ' + botToken });
  assert.equal(history.status, 200);
  assert.ok(history.data.messages.length >= 1);
  ok('the bot API reads channel history');

  const aiPatch = await call('PATCH', `/api/bots/${bot.id}`, { body: { mode: 'ai', prompt: 'You are funny.' }, cookie: alice.cookie });
  assert.equal(aiPatch.status, 200);
  await call('POST', `/api/channels/${general.id}/messages`, { body: { content: '@HelperBot tell me a joke' }, cookie: bob.cookie });
  await settle();
  assert.equal((await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages.at(-1).content, 'Hi there!');
  ok('AI mode without an Xkiro key falls back to the default reply');

  const rotated = await call('POST', `/api/bots/${bot.id}/token`, { cookie: alice.cookie });
  assert.equal((await call('GET', `/api/bot/channels/${general.id}/messages`, { auth: 'Bearer ' + botToken })).status, 401);
  assert.equal((await call('GET', `/api/bot/channels/${general.id}/messages`, { auth: 'Bearer ' + rotated.data.token })).status, 200);
  ok('rotating the token revokes the old one');
}

// Editing messages
{
  const msg = (await call('POST', `/api/channels/${general.id}/messages`, { body: { content: 'typo mesage' }, cookie: alice.cookie })).data.message;
  assert.equal((await call('PATCH', `/api/messages/${msg.id}`, { body: { content: 'x' }, cookie: bob.cookie })).status, 403);
  const edited = await call('PATCH', `/api/messages/${msg.id}`, { body: { content: 'typo fixed' }, cookie: alice.cookie });
  assert.equal(edited.status, 200);
  assert.ok(edited.data.message.edited_at);
  const list = (await call('GET', `/api/channels/${general.id}/messages`, { cookie: bob.cookie })).data.messages;
  const shown = list.find((m) => m.id === msg.id);
  assert.equal(shown.content, 'typo fixed');
  assert.ok(shown.edited_at);
  assert.equal((await call('PATCH', `/api/messages/${msg.id}`, { body: { content: '   ' }, cookie: alice.cookie })).status, 400);
  ok('authors edit their messages; others cannot; edited_at is shown');
}

// Profiles
{
  const saved = await call('PATCH', '/api/me/profile', {
    body: { bio: 'I build things.', bannerColor: '#00ff88', frame: 'neon' }, cookie: alice.cookie,
  });
  assert.equal(saved.status, 200);
  const profile = (await call('GET', `/api/users/${alice.user.id}`, { cookie: bob.cookie })).data.user;
  assert.equal(profile.bio, 'I build things.');
  assert.equal(profile.frame, 'neon');
  assert.equal(profile.bannerColor, '#00ff88');
  ok('save bio, banner color and frame; other users can read the profile');

  assert.equal((await call('PATCH', '/api/me/profile', { body: { frame: 'rainbow-unicorn' }, cookie: alice.cookie })).status, 400);
  assert.equal((await call('PATCH', '/api/me/profile', { body: { bannerColor: 'red' }, cookie: alice.cookie })).status, 400);
  assert.equal((await call('PATCH', '/api/me/profile', { body: { bio: 'x'.repeat(191) }, cookie: alice.cookie })).status, 400);
  ok('unknown frames, bad colors and long bios are rejected');

  assert.equal((await call('POST', '/api/me/avatar', { raw: new Uint8Array([1]), contentType: 'image/png', cookie: alice.cookie })).status, 503);
  const notImage = await call('POST', '/api/me/avatar', { raw: new Uint8Array([1]), contentType: 'text/html', cookie: alice.cookie, target: envWithB2 });
  assert.equal(notImage.status, 415);
  ok('avatars need storage configured and must be images');
}

// Typing
{
  assert.equal((await call('POST', `/api/channels/${general.id}/typing`, { cookie: alice.cookie })).status, 200);
  const seenByBob = (await call('GET', `/api/channels/${general.id}/typing`, { cookie: bob.cookie })).data.typing;
  assert.deepEqual(seenByBob, [{ username: 'Alice', bot: false }]);
  assert.deepEqual((await call('GET', `/api/channels/${general.id}/typing`, { cookie: alice.cookie })).data.typing, []);
  ok('typing shows to other members, never to yourself');
}

// Emojis, with the Nitro rule
{
  const waveFile = crypto.randomUUID();
  db.prepare("INSERT INTO files (id, owner_id, channel_id, storage_key, name, mime, size, created_at, purpose) VALUES (?, ?, NULL, 'k1', 'wave.png', 'image/png', 10, 0, 'emoji')").run(waveFile, alice.user.id);
  const made = await call('POST', `/api/servers/${lab.id}/emojis`, { body: { name: 'wave', fileId: waveFile }, cookie: alice.cookie });
  assert.equal(made.status, 201);
  assert.equal((await call('POST', `/api/servers/${lab.id}/emojis`, { body: { name: 'wave', fileId: waveFile }, cookie: alice.cookie })).status, 409);
  ok('owners add emojis; a duplicate name on the same server is refused');

  const bobsServer = (await call('POST', '/api/servers', { body: { name: 'Bobs' }, cookie: bob.cookie })).data.server;
  const bobsChannel = (await call('GET', `/api/servers/${bobsServer.id}`, { cookie: bob.cookie })).data.channels[0];
  const catFile = crypto.randomUUID();
  db.prepare("INSERT INTO files (id, owner_id, channel_id, storage_key, name, mime, size, created_at, purpose) VALUES (?, ?, NULL, 'k2', 'cat.png', 'image/png', 10, 0, 'emoji')").run(catFile, bob.user.id);
  await call('POST', `/api/servers/${bobsServer.id}/emojis`, { body: { name: 'cat', fileId: catFile }, cookie: bob.cookie });

  const plainList = (await call('GET', `/api/channels/${general.id}/emojis`, { cookie: alice.cookie })).data;
  assert.deepEqual(plainList.emojis.map((e) => e.name), ['wave']);
  ok('without Nitro, you only see the emojis of the server you are in');

  await call('POST', '/api/servers/join', { body: { invite: bobsServer.invite_code }, cookie: alice.cookie });
  assert.deepEqual((await call('GET', `/api/channels/${general.id}/emojis`, { cookie: alice.cookie })).data.emojis.map((e) => e.name), ['wave']);
  ok('joining another server does not unlock its emojis without Nitro');

  db.prepare('UPDATE users SET nitro = 1 WHERE id = ?').run(alice.user.id);
  const nitroList = (await call('GET', `/api/channels/${general.id}/emojis`, { cookie: alice.cookie })).data;
  assert.deepEqual(nitroList.emojis.map((e) => e.name), ['cat', 'wave']);
  assert.equal(nitroList.nitro, true);
  ok('with Nitro, emojis from every server you belong to are usable');

  const bobsChannelList = (await call('GET', `/api/channels/${bobsChannel.id}/emojis`, { cookie: alice.cookie })).data;
  assert.ok(bobsChannelList.emojis.some((e) => e.name === 'cat'));
  assert.equal((await call('DELETE', `/api/emojis/${catFile}`, { cookie: alice.cookie })).status, 404);
  ok('emoji lookups work from any channel you can read');

  const emojiRow = db.prepare('SELECT id FROM emojis WHERE name = ?').get('cat');
  assert.equal((await call('DELETE', `/api/emojis/${emojiRow.id}`, { cookie: alice.cookie })).status, 403);
  assert.equal((await call('DELETE', `/api/emojis/${emojiRow.id}`, { cookie: bob.cookie })).status, 200);
  ok('only the owner of a server deletes its emojis');

  const served = await call('GET', `/api/files/${waveFile}`, { cookie: bob.cookie });
  assert.equal(served.status, 503);
  ok('profile and emoji files are readable by signed-in users (503 here, no B2)');
}

console.log('\nAll Hellcord phase 2 tests passed.');
