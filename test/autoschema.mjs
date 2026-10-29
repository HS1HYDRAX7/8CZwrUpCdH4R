import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

// An empty database: no migrations applied by hand.
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const env = {
  DB: {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let params = [];
      const query = {
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

const res = await worker.fetch(new Request('https://hellcord.test/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Hellcord' },
  body: JSON.stringify({ username: 'alice', password: 'password123' }),
}), env);
const data = await res.json();
assert.equal(res.status, 201, JSON.stringify(data));
assert.equal(data.user.username, 'alice');
console.log('  ok - register works on an empty database (tables created automatically)');
console.log('\nAuto-schema test passed.');
