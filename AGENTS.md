# MyFa Host Telegram Serverless rules

This branch targets Telegram Serverless CLI 0.2.x.

## Runtime rules

- All deployed backend JavaScript lives under `tgcloud/`.
- Use only `sdk`, `sdk/db`, and the documented Serverless runtime APIs.
- Import project modules with relative paths ending in `.js`.
- Do not import npm packages from Serverless modules.
- Do not use Node.js `fs`, `child_process`, `Buffer`, Express, Telegraf, eval, Function, or shell commands in Serverless modules.
- Every endpoint must derive identity from `ctx.initData.user`.
- Every bot resource operation must verify ownership server-side.
- Keep secrets out of source control.
- Deploy code with `npx tgcloud push`; apply schema changes separately with `npx tgcloud migrate`.

## Architecture

- `tgcloud/handlers/` handles Telegram updates.
- `tgcloud/endpoints/` handles authenticated Mini App calls.
- `tgcloud/lib/` contains shared helpers.
- `tgcloud/schema.js` is the only database schema file.
- `public/` is the Mini App static frontend configured by `tgcloud.jsonc`.

## Product boundary

MyFa Host must not claim to execute arbitrary user programs inside Telegram Serverless. User-bot execution is a separate architecture problem. Declarative Telegram bot configuration is safe to migrate; arbitrary code execution is not.
