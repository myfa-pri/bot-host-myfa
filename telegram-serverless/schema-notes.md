# Schema and endpoint mapping notes

The initial schema is normalized and intentionally does not store secrets such as bot tokens in the web-accessible database tables. Bot token storage needs a separate product decision and secret-handling review before enabling user-added bots. The existing Firebase RTDB data layout is key/value-centric; migrating it requires explicit mapping and import logic rather than copying JSON blobs into a few columns.

## Legacy Firebase keys found in the existing code

Representative keys from `api/index.js` include:
- `users/{userId}`
- `user_{userId}_bots`
- `bot_{botId}_commands`
- `bot_{botId}_env`
- `bot_{botId}_settings`
- `bot_{botId}_logs`
- `bot_{botId}_analytics`
- `active_deployments`
- `global_stats`
- `activity_logs`
- `invites/{code}`
- `user_{userId}_notifications`
- referral, coupon, template and platform settings keys

These values must be inventoried in the legacy implementation before defining import jobs. Since the old schema is flexible and some lists are written by read/modify/write, concurrency, uniqueness and authorization behavior should be tested during conversion.

## Not yet complete

This branch is a migration scaffold, not a completed port of every legacy endpoint. The source includes thousands of lines of API behavior across main bot, admin routes, user bot code execution, custom commands, referrals, coupons, environment variables, backups, logs, analytics, templates and AI. Finishing the migration requires porting each capability to a named endpoint using the exact API in the versioned scaffold SDK reference, then changing every frontend caller and testing the full UI against that contract.

Do not represent the platform as fully migrated until:
- a feature-by-feature endpoint inventory exists,
- every endpoint is implemented and authorization-tested,
- every old frontend API call has been replaced or explicitly retained on another HTTPS backend,
- Firebase records are imported and checked,
- the bot's live webhook and Mini App launch are tested on a staging bot,
- user-code execution has been removed or moved into an isolated execution service.
