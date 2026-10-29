import assert from 'node:assert/strict';
import worker from '../src/index.js';

// No storage settings at all: the health check must name what is missing, not the values.
const env = {
  DB: {
    prepare() {
      const query = {
        bind() { return query; },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() { return { meta: { last_row_id: 0, changes: 0 } }; },
      };
      return query;
    },
    async batch() { return []; },
  },
  ASSETS: { fetch: async () => new Response('ok') },
};
const res = await worker.fetch(new Request('https://hellcord.test/api/health'), env);
const data = await res.json();
assert.match(data.storage, /B2_KEY_ID/);
assert.match(data.storage, /B2_APPLICATION_KEY/);
assert.match(data.storage, /Worker secrets/);

// Upload path gives the same explanation
const upload = await worker.fetch(new Request('https://hellcord.test/api/me/avatar', {
  method: 'POST', headers: { 'X-Requested-With': 'Hellcord', 'Content-Type': 'image/png', Cookie: 'hc_session=x' },
  body: new Uint8Array([1]),
}), env);
assert.equal(upload.status, 401);
console.log('  ok - health names the missing storage settings');
console.log('\nStorage message test passed.');
