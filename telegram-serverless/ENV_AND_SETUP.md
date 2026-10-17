# Local setup and first tests

## A. Revoke leaked token first

The previous Vercel code has a hard-coded Bot API token in `api/index.js`. Revoke and regenerate it in @BotFather before using the bot again. Do not commit secrets.

## B. Prepare the project

1. Install Node.js 18+ and Git.
2. Download the branch archive from:
   `https://github.com/myfa-pri/bot-host-myfa/archive/refs/heads/telegram-serverless-migration.zip`
3. Extract it. Open terminal inside the extracted folder.
4. Open @BotFather → your main bot → Serverless → enable Serverless.
5. In BotFather → Serverless → CLI Access, copy the CLI access token (`app<id>:<secret>`). This is not the Bot API token.
6. The current scaffolded Serverless project includes `docs/tgcloud-sdk.md`; create a clean scaffold to get that reference and the local CLI version if needed:
   ```bash
   npm create @tgcloud/bot myfa-serverless-reference
   cd myfa-serverless-reference
   npx tgcloud login
   ```
   Paste the CLI access token. **Do not copy .tgcloud credentials into Git.**
7. Copy the latest `docs/tgcloud-sdk.md` from the scaffold into the `telegram-serverless` folder for development reference if the CLI's SDK reference has changed.
8. Then open a terminal inside the extracted repository's `telegram-serverless` directory, and run `npm create @tgcloud/bot .` only if you have first backed up these source files: the creator won't overwrite existing files but will add missing scaffold assets. Alternatively copy these files into a fresh scaffolded directory. Recommended safer route: copy the contents of `telegram-serverless/` into the fresh scaffolded directory.
9. Run:
   ```bash
   npx tgcloud login
   npx tgcloud status
   npx tgcloud diff
   ```

## C. First test

Use the CLI project root (must contain the scaffold-installed `@tgcloud/cli` and `.tgcloud/`):

```bash
npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123, first_name: "Test" }, text: "/start" }'
npx tgcloud run handlers/message '{ chat: { id: 123 }, from: { id: 123, first_name: "Test" }, text: "hello" }'
npx tgcloud run handlers/callback_query '{ id: "callback-test", from: { id: 123 }, data: "help", message: { chat: { id: 123 } } }'
npx tgcloud status
```

## D. Deploy code and DB schema

Before deploying, verify your test bot is the intended one:

```bash
npx tgcloud diff
npx tgcloud push
npx tgcloud migrate --dry-run
npx tgcloud migrate
npx tgcloud status
npx tgcloud webhook
```

Schema deployment and database migration are separate operations. Review the migration summary before confirming. Do not use `--yes` on a production database before understanding each change.

## E. Mini App frontend

The existing frontend uses Vercel URLs such as `fetch('/api/my-bots?userId=...')`. These do not become Serverless endpoints automatically. The correct Mini App call pattern from Telegram's current Mini App documentation is:

```js
Telegram.WebApp.Serverless.call('getProfile', { locale: 'en' }, (error, result) => {
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(result);
});
```

The named endpoint's exact module/export format must come from the current scaffolded `docs/tgcloud-sdk.md`. Port and test each endpoint before replacing frontend calls. Use the platform-validated caller identity; never authorize from `initDataUnsafe.user.id` or browser-supplied `userId` alone.

The Mini App UI itself needs an HTTPS static host. Telegram Serverless provides backend logic; it is not a static asset host.

## F. Data migration

Do not point production users to a fresh empty database without importing their data. Export Firebase JSON from the Firebase console/admin SDK, create a mapping plan, convert each legacy collection/key to rows, and perform a one-time import with verified totals. Do not export bot tokens/secrets into source files. Implement idempotent imports and take a backup first.

## G. Product feature boundary

The current project runs uploaded user bot code using `eval` and invokes Python/Go/Java/Shell via Node child processes. Telegram Serverless doesn't expose this runtime and those approaches are unsafe for multi-tenant execution. Do not port them into Serverless handlers. Bot creation/settings/command management can be ported as data-driven features, but actually executing users' bots requires a separate sandboxed execution environment, or you must explicitly remove that function from the Telegram-only edition.
