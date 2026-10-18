# MyFa Host → Telegram Serverless migration

## Branch safety

This branch is the isolated Telegram Serverless migration track. The existing Vercel/Firebase implementation remains untouched on `main`.

The canonical Serverless project is now the root `tgcloud/` layout plus `tgcloud.jsonc`. The older `telegram-serverless/` folder is retained as migration notes/reference and is not the canonical deployment layout.

## What is now migrated

The branch now contains a real Telegram Serverless foundation:

- `tgcloud/schema.js` — SQLite-backed users, bots, commands, logs, message events and settings.
- `tgcloud/handlers/` — message, callback query, inline query, edited message, poll answer, chat member and bot membership handlers.
- `tgcloud/lib/` — authenticated user and ownership helpers.
- `tgcloud/endpoints/` — authenticated Mini App profile, bots, commands, statistics and compatibility operations.
- `tgcloud.jsonc` — Telegram-hosted Mini App static files from `public/`.
- `package.json` — Telegram Serverless CLI workflow.
- The existing Mini App UI remains in `public/`; a compatibility bridge translates its legacy `/api/*` calls to the authenticated Serverless endpoint while the UI is progressively migrated.

Telegram Serverless 0.2.0 supports Mini App hosting directly. The deployed frontend is served from an `app<app_id>.tgcloud.ai` address, while named endpoints are available under `/api/` and are callable from the Mini App with `Telegram.WebApp.Serverless.call`. See the official documentation for the current project layout and deployment model.

## Important security rules

1. Never commit Bot API tokens, Serverless CLI access tokens, Firebase credentials or user bot tokens.
2. Serverless endpoints must use `ctx.initData.user` as the authenticated identity. Do not trust a client-supplied `userId`.
3. Every bot read/write checks ownership server-side.
4. Do not execute arbitrary user JavaScript with `eval`, `Function`, `child_process`, shell commands or filesystem APIs in Serverless.
5. Keep the existing Vercel/Firebase branch as the rollback reference until data migration has been verified.
6. If a token was ever committed to Git history, revoke/regenerate it even if the literal was later removed.

## Mini App architecture

The target architecture is:

```text
Telegram
  |
  +-- MyFa Host bot
  |     +-- handlers/message.js
  |     +-- handlers/callback_query.js
  |     +-- handlers/...
  |
  +-- MyFa Host Mini App
        |
        +-- Telegram.WebApp.Serverless.call(...)
                    |
                    +-- tgcloud/endpoints/*
                    +-- tgcloud/schema.js (SQLite)
```

The existing HTML/CSS/JS UI is preserved instead of being rewritten from scratch. During migration, the compatibility bridge keeps legacy `fetch('/api/...')` calls working through one authenticated Serverless endpoint. New features should call named endpoints directly.

## Database migration

Serverless has one SQLite-backed database per Serverless bot. The schema is deployed separately from data migrations:

```bash
npx tgcloud push
npx tgcloud migrate --dry-run
npx tgcloud migrate
```

Do not delete old schema objects during the first migration. Add new columns/tables first, export/reconcile legacy Firebase data, verify it, and only then deprecate obsolete objects.

## User-created bot hosting: important platform boundary

The old MyFa Host runtime executed arbitrary user programs and long-running processes. That cannot be copied into Telegram Serverless: Serverless is a V8 sandbox for the single bot attached to the Serverless project, with no arbitrary npm runtime, filesystem, shell, Python/Go/Java process, or persistent worker.

Telegram now has a separate **managed bots** feature that lets a manager bot participate in creation and management of user-owned managed bots. This is useful for the future MyFa Host flow, but it does not by itself turn one Serverless project into a general-purpose multi-bot process host. The managed-bot execution/update architecture must be validated separately before claiming that every user bot can run entirely inside this one Serverless project.

Therefore this branch deliberately does **not** fake multi-bot execution. It stores bot ownership/configuration safely and removes arbitrary code execution from the Serverless path. The next production phase must choose one of:

- a Telegram-native managed-bot execution architecture if the current Telegram APIs provide the complete update/runtime path required by MyFa Host, or
- a separate execution service for user bots while MyFa Host itself remains fully Telegram-hosted.

## Local workflow

From the repository root:

```bash
npm install
npx tgcloud login
npx tgcloud status
npx tgcloud diff
npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123, first_name: "Test" }, text: "/start" }'
npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123, first_name: "Test" }, text: "/poll" }'
npx tgcloud push
npx tgcloud migrate --dry-run
npx tgcloud migrate
npx tgcloud webhook
npx tgcloud webhook sync
```

The CLI access token is the `app<id>:<secret>` token from BotFather → Serverless → CLI Access. It is different from the normal Bot API token and must never be committed.

## Compatibility status

| Capability | Status in this branch |
|---|---|
| Main bot message handler | Migrated |
| Inline buttons / callback queries | Migrated |
| Reply keyboard | Migrated |
| Native polls / poll answers | Migrated |
| Membership update handlers | Migrated foundation |
| Telegram-hosted Mini App static files | Configured |
| Authenticated Mini App endpoints | Migrated foundation |
| SQLite Serverless database | Schema migrated foundation |
| Legacy `/api/*` frontend compatibility | Bridge added for core routes |
| Existing full Vercel API parity | Not yet complete; routes must be ported and tested individually |
| Firebase → SQLite data transfer | Not performed automatically; requires controlled export/import and reconciliation |
| Arbitrary user code execution | Intentionally removed for safety/platform compatibility |
| Full multi-bot runtime | Not claimed until Telegram managed-bot/update execution path is proven |
| Vercel main branch | Preserved as rollback/reference |

## Official documentation

- https://core.telegram.org/bots/serverless
- https://core.telegram.org/bots/webapps
- https://core.telegram.org/api/bots/managed-bots
