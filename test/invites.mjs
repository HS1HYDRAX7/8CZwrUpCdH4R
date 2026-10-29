import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const env = {
  DB: {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const query = {
        sql,
        bind(...values) { params = values; return query; },
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() { const info = stmt.run(...params); return { meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes } }; },
      };
      return query;
    },
    async batch(queries) { const out = []; for (const q of queries) out.push(await q.run()); return out; },
  },
  ASSETS: { fetch: async () => new Response('ok') },
};

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'Hellcord';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await worker.fetch(new Request('https://hellcord.test' + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  }), env);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
const cookieOf = async (username) => {
  const res = await worker.fetch(new Request('https://hellcord.test/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Hellcord' },
    body: JSON.stringify({ username, password: 'password123' }),
  }), env);
  return { user: (await res.json()).user, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};
const ok = (label) => console.log('  ok -', label);

const alice = await cookieOf('Alice');
const bob = await cookieOf('Bob');
const carol = await cookieOf('Carol');
const dan = await cookieOf('Dan');
const server = (await call('POST', '/api/servers', { body: { name: 'Lab' }, cookie: alice.cookie })).data.server;
ok('setup: Alice owns a server; Bob, Carol and Dan are signed up');

// Create and preview
const single = await call('POST', `/api/servers/${server.id}/invites`, { body: { maxUses: 1, expiresInHours: 24 }, cookie: alice.cookie });
assert.equal(single.status, 201);
const code = single.data.invite.code;
assert.ok(code.length >= 6);
const preview = await call('GET', `/api/invites/${code}`, { cookie: bob.cookie });
assert.equal(preview.data.invite.status, 'active');
assert.equal(preview.data.invite.serverName, 'Lab');
assert.equal(preview.data.invite.joined, false);
ok('create an invite; anyone signed in can preview it (server name, status)');

assert.equal((await call('POST', `/api/servers/${server.id}/invites`, { body: { maxUses: 3 }, cookie: alice.cookie })).status, 400);
assert.equal((await call('POST', `/api/servers/${server.id}/invites`, { body: { expiresInHours: 5 }, cookie: alice.cookie })).status, 400);
ok('uses and expiry must be one of the offered choices');

// Single-use: first joiner wins, the second is refused
assert.equal((await call('POST', '/api/servers/join', { body: { invite: code }, cookie: bob.cookie })).status, 200);
const carolTry = await call('POST', '/api/servers/join', { body: { invite: code }, cookie: carol.cookie });
assert.equal(carolTry.status, 410);
assert.match(carolTry.data.error, /no uses left/);
ok('a one-use invite lets exactly one person in');

const again = await call('POST', '/api/servers/join', { body: { invite: code }, cookie: bob.cookie });
assert.equal(again.status, 200);
assert.equal(again.data.alreadyMember, true);
ok('joining again is harmless and says you are already a member');

const bobPreview = await call('GET', `/api/invites/${code}`, { cookie: bob.cookie });
assert.equal(bobPreview.data.invite.joined, true);
ok('the preview tells a member they are already in');

// Revoke
const open = await call('POST', `/api/servers/${server.id}/invites`, { body: { maxUses: 0, expiresInHours: 0 }, cookie: alice.cookie });
const openCode = open.data.invite.code;
assert.equal((await call('DELETE', `/api/invites/${openCode}`, { cookie: dan.cookie })).status, 403);
assert.equal((await call('DELETE', `/api/invites/${openCode}`, { cookie: bob.cookie })).status, 403);
ok('only the creator or the owner can revoke an invite');
assert.equal((await call('DELETE', `/api/invites/${openCode}`, { cookie: alice.cookie })).status, 200);
const revoked = await call('POST', '/api/servers/join', { body: { invite: openCode }, cookie: carol.cookie });
assert.equal(revoked.status, 410);
assert.match(revoked.data.error, /revoked/);
ok('a revoked invite stops working');

// Expiry
const timed = await call('POST', `/api/servers/${server.id}/invites`, { body: { expiresInHours: 1 }, cookie: alice.cookie });
db.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 1000, timed.data.invite.code);
const expired = await call('POST', '/api/servers/join', { body: { invite: timed.data.invite.code }, cookie: carol.cookie });
assert.equal(expired.status, 410);
assert.match(expired.data.error, /expired/);
ok('an expired invite is refused');

// Permanent code from before the invites table existed
const legacy = await call('POST', '/api/servers/join', { body: { invite: server.invite_code }, cookie: carol.cookie });
assert.equal(legacy.status, 200);
ok('the server’s original permanent code still works');

assert.equal((await call('POST', '/api/servers/join', { body: { invite: 'nope-nope' }, cookie: carol.cookie })).status, 404);
ok('unknown codes are not found');

// Listing: members only
const list = await call('GET', `/api/servers/${server.id}/invites`, { cookie: alice.cookie });
assert.equal(list.status, 200);
assert.ok(list.data.invites.some((i) => i.legacy));
assert.ok(list.data.invites.some((i) => i.status === 'revoked'));
assert.equal((await call('GET', `/api/servers/${server.id}/invites`, { cookie: dan.cookie })).status, 404);
ok('the invite list shows statuses and is hidden from non-members');

console.log('\nInvite tests passed.');
