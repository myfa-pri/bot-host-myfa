# Mini App integration bridge

The current Mini App frontend files from `public/` are large and must be ported carefully. They contain many calls to Vercel API routes. This file records the target bridge pattern; it does not claim every UI operation is migrated.

## 1. Load Telegram WebApp

Include the official script in the HTML `<head>`:

```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

Initialize:

```js
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
```

Do not trust `tg.initDataUnsafe.user.id` as authentication. For Serverless endpoint calls, use the platform bridge:

```js
function callServerless(name, input = {}) {
  return new Promise((resolve, reject) => {
    const serverless = window.Telegram?.WebApp?.Serverless;
    if (!serverless?.call) {
      reject(new Error('Open this app from Telegram with Serverless enabled.'));
      return;
    }
    serverless.call(name, input, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}
```

Example usage after an endpoint named `getProfile` has been added using the current SDK contract:

```js
async function refreshProfile() {
  try {
    const profile = await callServerless('getProfile', {});
    document.querySelector('#profile-name').textContent = profile.firstName;
    document.querySelector('#profile-plan').textContent = profile.plan;
  } catch (error) {
    console.error('Unable to load profile', error);
  }
}
```

## 2. Port each old API call

Do not simply change the host or URL in the old `fetch()`. For every old route:

- Locate its matching UI usage.
- Define a Serverless named endpoint following `docs/tgcloud-sdk.md`.
- Derive caller identity from the platform-provided validated Mini App context.
- Validate input shape and lengths.
- Authorize record ownership or admin status server-side.
- Return only fields required by the UI; never return stored bot tokens or secrets.
- Change the frontend to call the endpoint by name.
- Add a `tgcloud run` / staging verification before removing the old route.

Examples of legacy calls to port include `/api/global-stats`, `/api/my-bots`, `/api/create-bot`, `/api/commands`, `/api/save-command`, `/api/env-vars`, `/api/bot-logs`, `/api/bot-analytics`, and the `/api/admin/*` surface.

## 3. Do not keep untrusted code execution

The old backend runs user-defined JavaScript via `eval`, and attempts Python/Go/Java execution using Node filesystem/child process. Telegram Serverless does not offer Node filesystem, child processes, arbitrary packages, or persistent bot processes. Never add that behavior to Serverless handlers. To preserve true bot hosting, use a separate sandboxed execution environment; otherwise redesign MyFa Host as bot configuration/management instead of executing user programs.
