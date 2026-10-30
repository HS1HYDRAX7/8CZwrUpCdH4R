# Hellcord v11: audit and changes

Scope of this pass: Phase 1 (audit and fixes). The full brief (calls, presence, mentions, bot expansion,
admin panel UI, redesign) is NOT done. See "Not done" below.

## Findings

| # | Area | Finding | Severity | Status |
|---|------|---------|----------|--------|
| 1 | Security / owner | Owner privilege was granted by username `thatoneranger` in login, profile, requirePlatformOwner, sanctions and the client. Anyone who registered that name first would become owner. | Critical | Fixed: only `users.is_platform_owner` counts. Claim-once with `OWNER_BOOTSTRAP_TOKEN`. Tested. |
| 2 | Security / CSP | `script-src 'self'` blocked the PeerJS script on unpkg.com, so PeerJS never loaded. | High | Fixed: CSP allows `https://unpkg.com` for scripts and `https://0.peerjs.com` / `wss://0.peerjs.com` for signaling. |
| 3 | Supply chain | PeerJS loaded from unpkg without Subresource Integrity. | High | Open: needs the SRI hash of peerjs@1.5.4 (cannot be fetched offline). Preferred fix: vendor the file in `public/vendor/`. |
| 4 | Calls | PeerJS is loaded but never used in `app.js` (no Peer object, no call code). Voice/video/screen share are not implemented. | High | Open. |
| 5 | Tests | `nodb` expected the wrong migration binding name (`hellcord` instead of `DB`). | Medium | Fixed (message now says `DB`). |
| 6 | Schema | Schema statement logs show `The "sql" argument must be a string` during fresh-database tests. Statements are strings; the message comes from a test adapter path. Caught and logged, does not break tests. | Low | Open: investigate the adapter. |
| 7 | Branch | This zip differs from the earlier branch: it has no reactions, replies, pins, storage cleanup cron or deduplication from earlier work. | Medium | Decide which branch is canonical. |
| 8 | Cron | No `[triggers]` in wrangler.toml, so no scheduled cleanup runs. | Medium | Open (needs the storage cleanup code of the other branch). |
| 9 | Frontend | Client-side owner checks used the username. | High | Fixed: client uses the server flag only. |

## Changes in this pass

- `src/index.js`: removed name-based owner bootstrap in login; CSP fixed for PeerJS; migration message uses `DB`.
- `src/features.js`: `requirePlatformOwner` checks the flag only; `bootstrapOwner` replaced by `claimOwner`
  (secret token, 32+ characters, one conditional UPDATE, returns 409 once an owner exists); profile and
  sanctions checks use the flag only.
- `public/app.js`: owner checks use `platformOwner` from the server.
- `test/owner.mjs`: new. Proves that the name confers nothing, the claim needs the secret, the claim is
  single-use, and only the owner manages badges.
- `README.md`: owner setup section (`npx wrangler secret put OWNER_BOOTSTRAP_TOKEN`, then the claim call).

## Configuration needed

- `OWNER_BOOTSTRAP_TOKEN` (Worker secret, 32+ random characters). Then log in as the owner and call
  `POST /api/admin/bootstrap-owner` with `{"token": "..."}`.
- PeerJS: vendor the file or add the SRI hash to the `<script>` tag.
- Calls at scale: Cloudflare Realtime SFU (1,000 GB/month free egress shared with TURN) or LiveKit Cloud.
- Real-time events: Durable Objects (WebSockets) need a `[[durable_objects.bindings]]` entry and a migration.

## Not done (remaining brief)

Phases 2 to 7 are not implemented in this pass: redesign, PeerJS calls (1:1 and group), recording,
presence states and sync, mention autocomplete, bot/XKiro expansion (slash menus, embeds, webhooks,
per-user context), admin/moderation panel UI, threads, polls, events, global search, realtime (WebSocket)
transport, and a full test matrix.
