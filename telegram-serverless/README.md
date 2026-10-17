# MyFa Host on Telegram Serverless (migration starter)

This directory contains a clean Serverless-native starter for the backend and Mini App calling contract. It does not replace the legacy app yet; see `../TELEGRAM_SERVERLESS_MIGRATION.md`.

## Why this is separate

The legacy app is an Express/Telegraf API hosted by Vercel and uses Firebase Realtime Database. Telegram Serverless runs a constrained JavaScript module system (handlers, shared library modules, and schema) with its own SQLite-backed database. It does not run Express, Telegraf, Node.js packages, filesystem APIs, child processes, or arbitrary runtime code. Serverless backend endpoints are called from the Telegram Mini App via `Telegram.WebApp.Serverless.call` and have platform-validated initData.

The full MyFa Host has additional product features (a user bot deployment/execution engine) that cannot be migrated into Serverless as-is: arbitrary hosted bots/processes and Python/Go/Java/Shell execution need a separate sandbox/runtime. This folder is an authenticated foundation for the main bot and DB, not a false claim that every legacy endpoint has been ported.

## Setup

1. Install Node.js 18 or newer.
2. In Telegram, open @BotFather → select your main MyFa Host bot → Serverless → enable it.
3. Download this repository's `telegram-serverless` directory (or run commands from this directory after cloning).
4. Run `npm create @tgcloud/bot myfa-serverless` into a separate temp folder to get the latest scaffold and SDK reference. Copy the `docs/tgcloud-sdk.md` and starter metadata to this project directory if the CLI version is newer; do not guess undocumented endpoint APIs.
5. Run `npx tgcloud login` and paste the **Serverless CLI Access token** from BotFather → Serverless → CLI Access. It is not the standard Bot API token.
6. Run `npx tgcloud status`, `npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123, first_name: "Test" }, text: "/start" }'`, review `npx tgcloud diff`, then `npx tgcloud push`.
7. Run `npx tgcloud migrate --dry-run`, inspect the changes, then run `npx tgcloud migrate` interactively.
8. Check the bot in Telegram. Do not switch the live frontend to these endpoints until the complete endpoint port is tested.

## Important security note

The current legacy `api/index.js` contains a literal bot token in the source code. Treat it as compromised and revoke/regenerate it through @BotFather before production. Do not copy secrets into source code or this branch.

## Existing UI

`public/index.html` and `public/admin.html` are large legacy Vercel frontend files and are intentionally left intact on main. Telegram Serverless is the backend, not a static HTML web host; continue hosting the Mini App over HTTPS on a static frontend host while switching its JavaScript to the Serverless endpoint calls. Any identity used by the backend must come from validated Mini App initData, not `userId` supplied by the browser.

## Files

- `schema.js` — normalized starter tables for users, owned bot metadata, command definitions, audit/activity logs, and per-bot logs.
- `handlers/message.js` — main bot /start, /help, /status and /stats message handler.
- `handlers/callback_query.js` — callback buttons for channel re-check and app launch.
- `lib/users.js` — safe user upsert and lookup.
- `lib/access.js` — ownership/admin authorization helper.
- `lib/telegram.js` — SDK Bot API helpers.

## Current limitations and migration work still required

The existing application contains a large API surface (admin, templates, bot commands, environment variables, deployment metadata, invitations, referrals, coupons, backups, logs, analytics, HTML pages and MyFa AI). These need explicit named endpoint modules that conform to the exact endpoint export pattern documented by the current scaffold's `docs/tgcloud-sdk.md`. Do not keep Vercel `/api/*` URLs as if they were Serverless endpoints.

Before final production migration:
- Export Firebase data and map it to the schema; test an import with a backup.
- Rewrite each frontend `fetch('/api/...')` to `Telegram.WebApp.Serverless.call('endpointName', input, callback)`.
- Implement owner/team/admin checks on every endpoint and never return bot tokens to the frontend.
- Remove `eval` and all execution of user-provided code from this backend.
- Separate bot hosting/execution into a dedicated sandbox service or reduce that product feature scope.
