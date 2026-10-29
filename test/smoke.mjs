import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const file of ['0001_init.sql', '0002_bots_profiles_emojis.sql']) {
  db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
}

// Minimal D1 look-alike on top of node:sqlite (prepare/bind/first/all/run/batch).
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
      for (const q of queries) {
        if (/^\s*select/i.test(q.sql)) out.push(await q.all());
        else out.push(await q.run());
      }
      return out;
    },
  };
}

const assets = { fetch: async () => new Response('<!doctype html><title>Hellcord</title>', { headers: { 'Content-Type': 'text/html' } }) };
const env = { DB: d1(), ASSETS: assets };
const envWithB2 = { ...env, B2_KEY_ID: 'x', B2_APPLICATION_KEY: 'y', B2_BUCKET: 'hellcord-files', B2_ENDPOINT: 's3.us-east-005.backblazeb2.com', B2_REGION: 'us-east-005' };

async function call(method, path, { body, cookie, raw, contentType, headers = {}, env: target = env } = {}) {
  const h = { ...headers };
  if (method !== 'GET') h['X-Requested-With'] = 'Hellcord';
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (contentType) h['Content-Type'] = contentType;
  if (cookie) h.Cookie = cookie;
  const init = { method, headers: h };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (raw !== undefined) init.body = raw;
  const res = await worker.fetch(new Request('https://hellcord.test' + path, init), target);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const ok = (label) => console.log('  ok -', label);

// Security baseline
{
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(home.res.headers.get('x-content-type-options'), 'nosniff');
  ok('static pages carry CSP and nosniff');
}

// Auth
let alice, bob, aliceCookie, bobCookie;
{
  assert.equal((await call('GET', '/api/me')).status, 401);
  ok('me without session is 401');

  const noHeader = await worker.fetch(new Request('https://hellcord.test/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(noHeader.status, 403);
  ok('state-changing call without the request header is refused');

  const reg = await call('POST', '/api/auth/register', { body: { username: 'Alice', password: 'correct horse' } });
  assert.equal(reg.status, 201);
  aliceCookie = cookieFrom(reg.res);
  assert.match(aliceCookie, /^hc_session=/);
  alice = reg.data.user;
  ok('register creates a user and a session cookie');

  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'alice', password: 'another pass' } })).status, 409);
  ok('usernames are unique, case-insensitively');

  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'a b', password: 'long enough' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'bobby', password: 'short' } })).status, 400);
  ok('bad usernames and short passwords are rejected');

  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'wrong one!' } })).status, 401);
  const login = await call('POST', '/api/auth/login', { body: { username: 'ALICE', password: 'correct horse' } });
  assert.equal(login.status, 200);
  aliceCookie = cookieFrom(login.res);
  ok('login checks the password and accepts any letter case');

  const me = await call('GET', '/api/me', { cookie: aliceCookie });
  assert.equal(me.data.user.username, 'Alice');
  ok('me returns the signed-in user');

  const regBob = await call('POST', '/api/auth/register', { body: { username: 'bob', password: 'hunter2hunter2' } });
  bobCookie = cookieFrom(regBob.res);
  bob = regBob.data.user;
  ok('second user registers');
}

// Servers, invites and channels
let server, general;
{
  const created = await call('POST', '/api/servers', { body: { name: 'Lab' }, cookie: aliceCookie });
  assert.equal(created.status, 201);
  server = created.data.server;
  ok('create server');

  const details = await call('GET', `/api/servers/${server.id}`, { cookie: aliceCookie });
  assert.equal(details.data.channels.length, 1);
  assert.equal(details.data.channels[0].name, 'general');
  general = details.data.channels[0];
  assert.equal(details.data.members.length, 1);
  ok('new server starts with a #general channel and the owner as member');

  assert.equal((await call('GET', `/api/servers/${server.id}`, { cookie: bobCookie })).status, 404);
  ok('non-members cannot read a server');

  assert.equal((await call('POST', '/api/servers/join', { body: { invite: 'nope' }, cookie: bobCookie })).status, 404);
  const joined = await call('POST', '/api/servers/join', { body: { invite: server.invite_code }, cookie: bobCookie });
  assert.equal(joined.status, 200);
  ok('join with the invite code');

  assert.equal((await call('POST', `/api/servers/${server.id}/channels`, { body: { name: 'random' }, cookie: bobCookie })).status, 403);
  const channel = await call('POST', `/api/servers/${server.id}/channels`, { body: { name: 'Off Topic' }, cookie: aliceCookie });
  assert.equal(channel.status, 201);
  assert.equal(channel.data.channel.name, 'off-topic');
  ok('only the owner creates channels; names are normalised');

  assert.equal((await call('POST', `/api/servers/${server.id}/channels`, { body: { name: '!!' }, cookie: aliceCookie })).status, 400);
  ok('invalid channel names are rejected');
}

// Messages
let message;
{
  const posted = await call('POST', `/api/channels/${general.id}/messages`, {
    body: { content: 'hello https://example.com' }, cookie: aliceCookie,
  });
  assert.equal(posted.status, 201);
  message = posted.data.message;
  assert.equal(message.content, 'hello https://example.com');
  assert.equal(message.author.username, 'Alice');
  ok('post a message');

  assert.equal((await call('POST', `/api/channels/${general.id}/messages`, { body: { content: '   ' }, cookie: aliceCookie })).status, 400);
  ok('empty messages are rejected');

  assert.equal((await call('POST', `/api/channels/${general.id}/messages`, { body: { content: 'x'.repeat(2001) }, cookie: aliceCookie })).status, 400);
  ok('messages over 2000 characters are rejected');

  const list = await call('GET', `/api/channels/${general.id}/messages`, { cookie: bobCookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.messages.length, 1);
  ok('members read the channel history');

  const polled = await call('GET', `/api/channels/${general.id}/messages?after=${message.id}`, { cookie: bobCookie });
  assert.equal(polled.data.messages.length, 0);
  ok('polling with after= returns only newer messages');

  assert.equal((await call('GET', `/api/channels/${general.id}/messages`, { cookie: 'hc_session=forged' })).status, 401);
  ok('forged session cookies are rejected');

  const bobPost = await call('POST', `/api/channels/${general.id}/messages`, { body: { content: 'hi from bob' }, cookie: bobCookie });
  assert.equal(bobPost.status, 201);

  assert.equal((await call('DELETE', `/api/messages/${bobPost.data.message.id}`, { cookie: aliceCookie })).status, 200);
  ok('the server owner can delete any message');

  const bobMsg = await call('POST', `/api/channels/${general.id}/messages`, { body: { content: 'mine' }, cookie: bobCookie });
  assert.equal((await call('DELETE', `/api/messages/${message.id}`, { cookie: bobCookie })).status, 403);
  ok('members cannot delete other members\u2019 messages');
  assert.equal((await call('DELETE', `/api/messages/${bobMsg.data.message.id}`, { cookie: bobCookie })).status, 200);
  ok('authors can delete their own message');
}

// Uploads: validated before anything reaches B2
{
  const noStorage = await call('POST', `/api/channels/${general.id}/files`, {
    raw: new Uint8Array([1, 2, 3]), contentType: 'image/png', headers: { 'X-File-Name': 'a.png' }, cookie: aliceCookie,
  });
  assert.equal(noStorage.status, 503);
  ok('uploads report a clear error when B2 is not configured');

  const badType = await call('POST', `/api/channels/${general.id}/files`, {
    raw: new Uint8Array([1, 2, 3]), contentType: 'text/html', headers: { 'X-File-Name': 'a.html' }, cookie: aliceCookie, env: envWithB2,
  });
  assert.equal(badType.status, 415);
  ok('HTML and other unlisted types are refused');

  const big = await call('POST', `/api/channels/${general.id}/files`, {
    raw: new Uint8Array([1]), contentType: 'audio/mpeg', headers: { 'X-File-Name': 'a.mp3', 'Content-Length': String(26 * 1024 * 1024) }, cookie: aliceCookie, env: envWithB2,
  });
  assert.equal(big.status, 413);
  ok('files over 25 MB are refused before upload');

  const notMember = await call('POST', `/api/channels/${general.id}/files`, {
    raw: new Uint8Array([1]), contentType: 'image/png', cookie: 'hc_session=nope', env: envWithB2,
  });
  assert.equal(notMember.status, 401);
  ok('uploads need a session');
}

// Sign out
{
  const out = await call('POST', '/api/auth/logout', { cookie: aliceCookie });
  assert.equal(out.status, 200);
  assert.match(out.res.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal((await call('GET', '/api/me', { cookie: aliceCookie })).status, 401);
  ok('logout ends the session on the server');
}

console.log('\nAll Hellcord smoke tests passed.');
