# MyFa Host → Telegram Serverless migration

## What this branch is

This branch is a migration track. It preserves the existing Vercel/Firebase files and documents the rewrite boundary so the main branch remains untouched.

The current application is a large Express/Telegraf + Firebase Realtime Database application. Telegram Serverless does **not** run Express routes, Telegraf polling/webhook servers, Node.js packages, Node filesystem APIs, or an arbitrary HTTP server. Telegram Serverless runs only JavaScript modules under `handlers/`, `lib/`, and root `schema.js`, using imports from `sdk` and `sdk/db`. The web Mini App can call named backend endpoints using `Telegram.WebApp.Serverless.call(name, input)`; the platform validates Mini App initData before the endpoint executes.

A full port must therefore migrate API route behavior into named Mini App endpoints and update the Mini App JavaScript to call those endpoints. It is not safe to blindly copy the existing `api/index.js` or its Express routes into this project.

## Critical security action

The previous main-branch `api/index.js` included a Bot API token as a literal. Treat that token as exposed: revoke/regenerate it with @BotFather before production use. Never add bot tokens, Serverless CLI credentials, Firebase admin credentials, or user bot tokens to Git.

## Scope to port

Port backend responsibilities (not Vercel transport) from the existing app:
- Main bot onboarding, help/status commands, mandatory-channel check, user registration, activity logs and statistics.
- User accounts, owned bots, team membership/invites, bot settings and per-bot command definitions.
- Templates, environment variable names/values, logs and analytics.
- Backup/restore data, folders, deployment metadata, referrals/rewards, coupons and admin settings.
- Main Mini App and admin Mini App UI.

Important platform mismatch: Serverless is a backend runtime for Telegram bot updates and named Mini App endpoints; it does not provide generic HTML hosting or an Express-like web server. The current `public/index.html` and `public/admin.html` still need an HTTPS frontend host (e.g. static hosting) unless Telegram adds a documented HTML hosting feature. Telegram Serverless can own the backend/database while the Mini App UI is hosted separately and uses `Telegram.WebApp.Serverless.call`.

Important bot-hosting mismatch: Serverless handlers run code for the **main bot**. It is not a general arbitrary-process container to keep every user-created bot running 24/7, and it does not support `eval`, `child_process`, Python/Go/Java runtimes, or arbitrary npm dependencies. Those capabilities in the current product cannot be reproduced merely by moving files into `handlers/`. They need a separate execution service / runtime or a product-scope decision to limit the platform to Telegram Serverless-compatible bots. Never execute untrusted user code inside main bot handlers.

## Safe migration sequence

1. Revoke the token previously committed in the source.
2. Enable Serverless for the main bot in @BotFather → Serverless and get its CLI access token.
3. Use the project scaffold and the SDK docs to establish exact current module conventions.
4. Create schema tables and a normalized data model, preserving ownership checks.
5. Move each Express API capability into a named Mini App endpoint. Each endpoint obtains the caller from platform-validated Mini App context; do not accept a client-supplied `userId` as identity.
6. Change Mini App calls from `fetch('/api/...')` to `Telegram.WebApp.Serverless.call('endpointName', input, callback)`.
7. Use handler files for incoming updates (message, callback_query, etc.) and `sdk/api` methods for Bot API calls.
8. Use `tgcloud run` for handler / endpoint tests, `tgcloud push` to deploy code, then inspect and run `tgcloud migrate` for schema changes.
9. Validate user permissions on every read/write; validate owner/team membership for every bot ID; never expose stored bot tokens to client-side JS.
10. Keep main-branch Firebase data intact until an explicit export/import and reconciliation plan has been tested.

## Suggested module shape

```
handlers/
  message.js
  callback_query.js
lib/
  authz.js
  users.js
  bots.js
  commands.js
  audit.js
  telegram.js
  endpoints/
    profile.js
    dashboard.js
    bot_list.js
    bot_create.js
    bot_settings.js
    commands.js
    templates.js
    analytics.js
    referrals.js
    admin.js
schema.js
```

The exact endpoint file naming and endpoint export API must follow the current scaffolded `docs/tgcloud-sdk.md`; do not infer it from an Express or Vercel example.

## Local commands

Use Node.js 18+:

```bash
npm create @tgcloud/bot myfa-serverless
cd myfa-serverless
npx tgcloud login
npx tgcloud status
npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123, first_name: "Test" }, text: "/start" }'
npx tgcloud push
npx tgcloud migrate
```

During migration, review `npx tgcloud diff` and `npx tgcloud migrate --dry-run` before approving changes. Push code and database migrations are intentionally separate.

## Compatibility matrix

| Existing capability | Telegram Serverless status |
|---|---|
| Main bot messages/callbacks | Supported through update handlers and SDK Bot API |
| Persistent users and settings | Supported via SQLite-backed Serverless DB; model/schema must be ported |
| Mini App authenticated backend | Supported via named endpoints and validated initData |
| Existing Express `/api/*` endpoints | Must be rewritten as named endpoints |
| Existing Mini App static HTML hosting | Not provided by the serverless backend itself; host UI separately |
| Telegraf / Express / axios / JSZip / npm packages in runtime | Not supported as runtime imports |
| Firebase Realtime Database calls | Must migrate into Serverless DB or explicitly retained external API calls |
| Run user-supplied JavaScript via `eval` | Unsafe; not supported/should be removed |
| Run Python/Go/Java/Shell as persistent deployments | Not provided by Serverless runtime |
| Main bot checks official-channel membership | Supported using Bot API `getChatMember`, assuming bot has the required channel access |
| Admin panel and access control | Supported only after moving API operations to named endpoints with server-side authorization |

## Official documentation

- https://core.telegram.org/bots/serverless
- https://core.telegram.org/bots/webapps
