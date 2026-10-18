# MyFa Host - Telegram Serverless Feature Matrix

## Supported in the Serverless branch

- Telegram Serverless static Mini App hosting from `public/`.
- Serverless handlers and endpoints under `tgcloud/`.
- Telegram Serverless SQLite as the canonical database for migrated data.
- Users, gems, coins, XP, levels, plans, bans and settings.
- Owned-bot records and declarative bot configuration.
- Command storage, aliases, replies and command settings.
- Activity logs, bot logs and message events.
- `/start`, `/help`, `/menu`, `/buttons`, `/keyboard`, `/poll`, `/react`, `/status`.
- Inline keyboards and callback queries.
- Reply keyboards.
- Native Telegram polls and poll-answer updates.
- Native message reactions with `setMessageReaction`.
- Edited messages.
- Inline queries and chosen inline results.
- Channel posts and edited channel posts.
- Chat member, bot membership and chat join request events.
- Chat boost and removed chat boost events.
- Business connection/message events.
- Managed-bot lifecycle updates.

## Intentionally not auto-enabled

Payment handlers are not configured to approve transactions automatically. Payment flows must be implemented with product/price validation before `pre_checkout_query` is approved.

Shipping queries are also not auto-approved.

## Critical platform boundary

Telegram Serverless is not a general-purpose VPS. It does not provide a per-user Node.js/Python process supervisor, arbitrary child processes, arbitrary npm installation at runtime, or 24/7 execution of uploaded user programs.

Therefore MyFa Host stores user bot configuration/source as data, but does not execute arbitrary uploaded code inside the Serverless runtime.

## Managed bots

Telegram supports managed bots: users can create bots controlled by a manager bot, and the manager receives managed-bot lifecycle updates. MyFa Host records those lifecycle events without storing bot tokens in SQLite.

A managed-bot token is sensitive and must never be committed to GitHub or stored in plaintext in the application database.

A separate runtime is required if MyFa Host is to execute arbitrary user programs for managed bots. That runtime cannot be replaced by Telegram Serverless alone.

## Production rule

Keep the original Vercel branch as a rollback/reference copy until the Serverless deployment has been tested in the real BotFather environment.
