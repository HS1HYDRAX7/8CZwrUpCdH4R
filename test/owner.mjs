import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const TOKEN = 'k7Q2vWmL9pX4cR8tY1bN6hG3sD5fJ0aZ'; // 32 characters, test only
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const baseEnv = {
  DB: {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const q = {
        sql,
        bind(...v) { params = v; return q; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() { const i = stmt.run(...params); return { meta: { last_row_id: Number(i.lastInsertRowid), changes: i.changes } }; },
      };
      return q;
    },
    async batch(qs) { const out = []; for (const q of qs) out.push(/^\s*select/i.test(q.sql) ? await q.all() : await q.run()); return out; },
  },
  ASSETS: { fetch: async () => new Response('ok') },
};
const env = { ...baseEnv, OWNER_BOOTSTRAP_TOKEN: TOKEN };

async function call(method, path, { body, cookie, env: target = env } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'Hellcord';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await worker.fetch(new Request('https://hellcord.test' + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  }), target);
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function signUp(username, target = env) {
  const res = await worker.fetch(new Request('https://hellcord.test/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Hellcord' },
    body: JSON.stringify({ username, password: 'password123' }),
  }), target);
  return { user: (await res.json()).user, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const ok = (label) => console.log('  ok -', label);

// 1. Someone registers the name ThatOneRanger before the real owner does. It must confer nothing.
const impostor = await signUp('ThatOneRanger');
const impostorLogin = await call('POST', '/api/auth/login', { body: { username: 'thatoneranger', password: 'password123' } });
assert.equal(impostorLogin.status, 200);
const impostorProfile = await call('GET', `/api/users/${impostor.user.id}`, { cookie: impostor.cookie });
assert.equal(impostorProfile.data.user.platformOwner, false);
const impostorBadge = await call('POST', '/api/admin/badges', { body: { name: 'Fake', icon: 'x', color: '#000000' }, cookie: impostor.cookie });
assert.equal(impostorBadge.status, 403);
ok('an account named ThatOneRanger gets no owner powers from its name');

// 2. Claiming is refused while the secret is not configured
const realOwner = await signUp('Ranger');
assert.equal((await call('POST', '/api/admin/bootstrap-owner', { body: { token: TOKEN }, cookie: realOwner.cookie, env: baseEnv })).status, 503);
ok('claiming is refused when OWNER_BOOTSTRAP_TOKEN is not set');

// 3. Wrong token
assert.equal((await call('POST', '/api/admin/bootstrap-owner', { body: { token: 'wrong' }, cookie: realOwner.cookie })).status, 403);
ok('a wrong claim token is refused');

// 4. The right token claims the role once
const claim = await call('POST', '/api/admin/bootstrap-owner', { body: { token: TOKEN }, cookie: realOwner.cookie });
assert.equal(claim.status, 200);
const ownerProfile = await call('GET', `/api/users/${realOwner.user.id}`, { cookie: realOwner.cookie });
assert.equal(ownerProfile.data.user.platformOwner, true);
ok('the right token claims the owner role');

// 5. Once claimed, nobody else can claim, even with the token
const other = await signUp('mallory');
assert.equal((await call('POST', '/api/admin/bootstrap-owner', { body: { token: TOKEN }, cookie: other.cookie })).status, 409);
ok('the role cannot be claimed twice');

// 6. Only the owner manages badges
assert.equal((await call('POST', '/api/admin/badges', { body: { name: 'Hacker', icon: 'x', color: '#000000' }, cookie: other.cookie })).status, 403);
assert.equal((await call('POST', '/api/admin/badges', { body: { name: 'Creator', icon: '✦', color: '#f5c451' }, cookie: realOwner.cookie })).status, 201);
ok('only the owner can create badges');

// 7. Still the owner after logging in again, and the impostor still has nothing
await call('POST', '/api/auth/login', { body: { username: 'Ranger', password: 'password123' } });
assert.equal((await call('GET', `/api/users/${realOwner.user.id}`, { cookie: realOwner.cookie })).data.user.platformOwner, true);
assert.equal((await call('GET', `/api/users/${impostor.user.id}`, { cookie: impostor.cookie })).data.user.platformOwner, false);
ok('the owner keeps the role across logins; name matches never grant it');

console.log('\nOwner tests passed.');
