import assert from 'node:assert/strict';
import worker from '../src/index.js';

// A database without migrations: every query fails the way D1 reports it.
const env = {
  DB: {
    prepare() {
      const query = {
        bind() { return query; },
        async first() { throw new Error('D1_ERROR: no such table: users: SQLITE_ERROR'); },
        async all() { throw new Error('D1_ERROR: no such table: users: SQLITE_ERROR'); },
        async run() { throw new Error('D1_ERROR: no such table: users: SQLITE_ERROR'); },
      };
      return query;
    },
    async batch() { throw new Error('D1_ERROR: no such table: users: SQLITE_ERROR'); },
  },
  ASSETS: { fetch: async () => new Response('ok') },
};

const res = await worker.fetch(new Request('https://hellcord.test/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Hellcord' },
  body: JSON.stringify({ username: 'alice', password: 'password123' }),
}), env);
const data = await res.json();
assert.equal(res.status, 503);
assert.match(data.error, /migrations apply DB --remote/);
console.log('  ok - missing tables explain the fix instead of a generic 500');
console.log('\nNo-database test passed.');
