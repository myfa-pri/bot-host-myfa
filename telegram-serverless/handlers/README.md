# Handlers folder

Telegram Serverless invokes one default-exported function per Telegram update type. Supported handler code must use only the platform SDK and project modules. Do not import Express, Telegraf, Node.js packages or filesystem/child-process modules. Use `npx tgcloud run handlers/message ...` to test, then `npx tgcloud push` to deploy.

The Mini App API endpoints are not Telegram update handlers. Implement them only using the named endpoint pattern documented by the current `docs/tgcloud-sdk.md` scaffold. This repo's API endpoints have not all been ported yet.
