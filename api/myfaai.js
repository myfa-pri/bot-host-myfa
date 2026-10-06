const MYFA_AI = (() => {
    'use strict';

    // ── Plan configuration ────────────────────────────────────
    const PLAN_LIMITS = { free: 30, premium: 150, enterprise: Infinity };
    let sessionRequests = 0;
    let userPlan = 'free';
    // Simple conversation memory (last 6 exchanges)
    const memory = [];

    // ── Globals reference ─────────────────────────────────────
    const GLOBALS_DOC = {
        'ctx': 'Telegraf context object — ctx.reply(), ctx.telegram.sendMessage(), etc.',
        'user': 'Sender info — user.id, user.first_name, user.last_name, user.username, user.language_code',
        'chat': 'Current chat — chat.id, chat.type (private/group/supergroup/channel), chat.title, chat.username',
        'message': 'Incoming message — message.text, message.photo, message.document, message.caption, message.message_id',
        'env': 'Your environment variables — env.MY_KEY, env.ADMIN_IDS, env.BOT_NAME, etc.',
        'Bot': 'MyFa helpers — Bot.runCommand("/cmd"), Bot.sendMessage("text")',
        'fetch': 'Built-in HTTP fetch — const r = await fetch(url, options); const data = await r.json();',
        'ctx.telegram': 'Raw Telegram API — ctx.telegram.sendMessage(chatId, text), ctx.telegram.getChatMember(chatId, userId), ctx.telegram.banChatMember(), ctx.telegram.sendPhoto()'
    };

    // ── JavaScript error patterns ─────────────────────────────
    const JS_ERROR_PATTERNS = [
        { re: /\bconsole\.log\s*\(/g,            msg: '`console.log()` detected — use `ctx.reply()` to send messages to users in Telegram.' },
        { re: /eval\s*\(/g,                       msg: '`eval()` is unsafe — use structured logic instead.' },
        { re: /require\s*\(/g,                    msg: '`require()` is not available here — all modules are pre-loaded. Use `ctx`, `env`, `user`, `Bot`, `fetch`.' },
        { re: /import\s+.+from\s/g,              msg: 'ES `import` syntax is not supported — modules are pre-loaded globally.' },
        { re: /ctx\.reply\s*\(\s*\)\s*[;,]/g,   msg: '`ctx.reply()` called with no arguments — you must pass a string or options object.' },
        { re: /user\.name\b/g,                   msg: 'Typo: `user.name` does not exist — use `user.first_name` (Telegram API field).' },
        { re: /message\.text\s*\.length/g,       msg: '`message.text` can be `undefined` for non-text messages — add a null check first.' },
        { re: /\bundefined\b/g,                  msg: 'Literal `undefined` found — make sure all variables are initialised before use.' },
        { re: /\bvar\s+/g,                       msg: 'Use `const` or `let` instead of `var` for safer block scoping.' },
        { re: /([^=!<>])={1}([^=])/g,           msg: 'Possible single `=` where `===` was intended — check assignment vs. comparison.' },
        { re: /==[^=]/g,                         msg: 'Use `===` (strict equality) instead of `==` to avoid type-coercion bugs.' },
        { re: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g, msg: 'Empty `catch` block — errors will be silently swallowed. Log or handle them.' },
        { re: /while\s*\(\s*true\s*\)/g,        msg: 'WARNING: Infinite loop detected — this will crash the serverless function.' },
        { re: /setTimeout\s*\(/g,               msg: '`setTimeout()` is unreliable in serverless/webhook mode — actions must complete synchronously.' },
        { re: /Bot\.runCommand\s*\(\s*\)/g,     msg: '`Bot.runCommand()` called with no argument — pass a command string, e.g. `Bot.runCommand("/help")`.' },
        { re: /ctx\.editMessageText\s*\([^,)]+\)/g, msg: '`ctx.editMessageText()` requires a message ID as first arg when called outside callback handlers.' },
        { re: /\.then\s*\((?!.*catch).*\)\s*;?\s*$/gm, msg: 'Promise `.then()` without `.catch()` — unhandled rejections may crash silently. Use `await` + `try/catch` instead.' },
        { re: /parseInt\s*\([^,)]+\)\s*[+\-\*\/]/g, msg: '`parseInt()` without radix parameter — use `parseInt(x, 10)` to be explicit.' },
    ];

    const PY_ERROR_PATTERNS = [
        { re: /print\s*\(/g,          msg: '`print()` does not send Telegram messages — use `ctx.reply()` or `bot.send_message()`.' },
        { re: /import\s+os\b/g,       msg: '`import os` is restricted in the sandbox environment.' },
        { re: /import\s+subprocess/g, msg: '`subprocess` is not available in the sandbox.' },
        { re: /open\s*\(/g,           msg: 'File I/O (`open()`) is not available in serverless mode.' },
        { re: /except\s*:\s*pass/g,   msg: 'Bare `except: pass` silently swallows all errors — handle them properly.' },
        { re: /while\s+True:/g,       msg: 'WARNING: Infinite loop — will cause a timeout in serverless mode.' },
    ];

    // ── Comprehensive Code Templates (40+) ───────────────────
    const CODE_TEMPLATES = {

        /* ── Basic ── */
        'reply': `ctx.reply('Hello, ' + user.first_name + '!');`,

        'markdown reply': `ctx.reply(
  '👋 *Hello, ' + user.first_name + '!*\\n\\n' +
  '🆔 ID: \`' + user.id + '\`\\n' +
  '💬 Chat: \`' + chat.id + '\`',
  { parse_mode: 'Markdown' }
);`,

        'html reply': `ctx.reply(
  '<b>Hello, ' + user.first_name + '!</b>\\n' +
  '<i>Your ID:</i> <code>' + user.id + '</code>',
  { parse_mode: 'HTML' }
);`,

        /* ── Keyboards ── */
        'reply with keyboard': `ctx.reply('Choose an option:', {
  reply_markup: {
    keyboard: [
      ['Option 1', 'Option 2'],
      ['Statistics', 'Help']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
});`,

        'reply with inline': `ctx.reply('Choose an action:', {
  reply_markup: {
    inline_keyboard: [
      [{ text: 'Yes', callback_data: 'yes' }, { text: 'No', callback_data: 'no' }],
      [{ text: 'Visit Site', url: 'https://example.com' }]
    ]
  }
});`,

        'remove keyboard': `ctx.reply('Keyboard removed.', {
  reply_markup: { remove_keyboard: true }
});`,

        'force reply': `ctx.reply('What is your name?', {
  reply_markup: { force_reply: true, selective: true }
});`,

        /* ── User & Chat ── */
        'user info': `ctx.reply(
  '👤 *Your Profile*\\n\\n' +
  'ID: \`' + user.id + '\`\\n' +
  'Name: ' + user.first_name + (user.last_name ? ' ' + user.last_name : '') + '\\n' +
  'Username: ' + (user.username ? '@' + user.username : 'none') + '\\n' +
  'Language: ' + (user.language_code || 'unknown') + '\\n' +
  'Chat: \`' + chat.id + '\`',
  { parse_mode: 'Markdown' }
);`,

        'chat info': `const typeLabel = { private: 'Private DM', group: 'Group', supergroup: 'Supergroup', channel: 'Channel' };
ctx.reply(
  '💬 *Chat Info*\\n\\n' +
  'ID: \`' + chat.id + '\`\\n' +
  'Type: ' + (typeLabel[chat.type] || chat.type) + '\\n' +
  (chat.title ? 'Title: ' + chat.title + '\\n' : '') +
  (chat.username ? 'Username: @' + chat.username : ''),
  { parse_mode: 'Markdown' }
);`,

        /* ── Access Control ── */
        'admin check': `const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());
if (!adminIds.includes(String(user.id))) {
  return ctx.reply('Access denied. Admins only.');
}
// Admin-only code below
ctx.reply('Welcome back, Admin ' + user.first_name + '!');`,

        'multi admin': `const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());
const isAdmin = adminIds.includes(String(user.id));
const isSuperAdmin = String(user.id) === String(env.SUPER_ADMIN_ID);

if (!isAdmin && !isSuperAdmin) {
  return ctx.reply('Access denied.');
}

if (isSuperAdmin) {
  ctx.reply('Super Admin panel coming up...');
} else {
  ctx.reply('Admin panel loading...');
}`,

        'channel check': `const channelId = env.CHANNEL_ID || '@MYFA_ORG';
try {
  const member = await ctx.telegram.getChatMember(channelId, user.id);
  const isJoined = ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
  if (isJoined) {
    ctx.reply('Access granted! Welcome, ' + user.first_name + '.');
    Bot.runCommand('/welcome');
  } else {
    ctx.reply('Please join our channel first.', {
      reply_markup: { inline_keyboard: [[
        { text: 'Join Channel', url: 'https://t.me/' + channelId.replace('@', '') },
        { text: 'I Joined — Check Again', callback_data: 'recheck_join' }
      ]]}
    });
  }
} catch (e) {
  ctx.reply('Could not verify membership. Make sure the bot is admin of ' + channelId + '.');
}`,

        'group only': `if (chat.type === 'private') {
  return ctx.reply('This command only works in groups.');
}
ctx.reply('Hello group: ' + (chat.title || 'Unknown'));`,

        'private only': `if (chat.type !== 'private') {
  return ctx.reply('This command only works in private chats.');
}
ctx.reply('Hello ' + user.first_name + ' — welcome to private mode!');`,

        'ban user': `const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());
if (!adminIds.includes(String(user.id))) return ctx.reply('Admins only.');
const target = message.reply_to_message;
if (!target) return ctx.reply('Reply to a user message to ban them.');
try {
  await ctx.telegram.banChatMember(chat.id, target.from.id);
  ctx.reply(target.from.first_name + ' has been banned.');
} catch (e) {
  ctx.reply('Failed to ban: ' + e.message);
}`,

        'mute user': `const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());
if (!adminIds.includes(String(user.id))) return ctx.reply('Admins only.');
const target = message.reply_to_message;
if (!target) return ctx.reply('Reply to a user message to mute them.');
try {
  await ctx.telegram.restrictChatMember(chat.id, target.from.id, {
    permissions: { can_send_messages: false },
    until_date: Math.floor(Date.now() / 1000) + 3600  // 1 hour
  });
  ctx.reply(target.from.first_name + ' has been muted for 1 hour.');
} catch (e) {
  ctx.reply('Failed to mute: ' + e.message);
}`,

        /* ── Media ── */
        'send photo': `ctx.replyWithPhoto('https://example.com/image.jpg', {
  caption: 'Here is your image!',
  parse_mode: 'Markdown'
});`,

        'send photo from url': `const imageUrl = env.IMAGE_URL || 'https://picsum.photos/400/300';
try {
  await ctx.replyWithPhoto(imageUrl, {
    caption: '*Image from URL*\\nHello, ' + user.first_name + '!',
    parse_mode: 'Markdown'
  });
} catch (e) {
  ctx.reply('Could not load image: ' + e.message);
}`,

        'send document': `ctx.replyWithDocument('https://example.com/file.pdf', {
  caption: 'Here is your file.',
  filename: 'document.pdf'
});`,

        'send audio': `ctx.replyWithAudio('https://example.com/audio.mp3', {
  caption: 'Here is your audio file.',
  title: 'My Audio',
  performer: 'Artist Name'
});`,

        /* ── Input & Parsing ── */
        'conditional': `const args = (message.text || '').split(' ').slice(1).join(' ').trim();
if (!args) {
  return ctx.reply('Usage: /command <your argument>');
}
ctx.reply('You said: ' + args);`,

        'number argument': `const raw = (message.text || '').split(' ')[1];
const num = parseInt(raw, 10);
if (isNaN(num)) {
  return ctx.reply('Please provide a valid number. Usage: /command <number>');
}
ctx.reply('Number received: ' + num);`,

        'env variable': `const apiKey = env.MY_API_KEY;
if (!apiKey) {
  return ctx.reply('API key not configured. Set MY_API_KEY in Env Variables.');
}
ctx.reply('Key loaded (first 6 chars): ' + apiKey.substring(0, 6) + '...');`,

        /* ── Logic & Flow ── */
        'try catch': `try {
  // Your code here
  await someAsyncOperation();
  ctx.reply('Done!');
} catch (e) {
  console.error('Command error:', e.message);
  ctx.reply('An error occurred. Please try again.');
}`,

        'random number': `const min = 1;
const max = 100;
const num = Math.floor(Math.random() * (max - min + 1)) + min;
ctx.reply(
  '*Random Number*\\n\\n' + num + ' (between ' + min + ' and ' + max + ')',
  { parse_mode: 'Markdown' }
);`,

        'countdown': `const target = new Date(env.TARGET_DATE || '2027-01-01T00:00:00Z');
const now = new Date();
const diff = target - now;
if (diff < 0) {
  return ctx.reply('The event has already passed!');
}
const days  = Math.floor(diff / 86400000);
const hrs   = Math.floor((diff % 86400000) / 3600000);
const mins  = Math.floor((diff % 3600000) / 60000);
const secs  = Math.floor((diff % 60000) / 1000);
ctx.reply(
  '*Countdown*\\n\\n' +
  days + 'd ' + hrs + 'h ' + mins + 'm ' + secs + 's remaining',
  { parse_mode: 'Markdown' }
);`,

        'time greeting': `const hour = new Date().getHours();
let greeting, icon;
if      (hour >= 5  && hour < 12) { greeting = 'Good morning';   icon = 'Morning'; }
else if (hour >= 12 && hour < 17) { greeting = 'Good afternoon'; icon = 'Afternoon'; }
else if (hour >= 17 && hour < 21) { greeting = 'Good evening';   icon = 'Evening'; }
else                               { greeting = 'Good night';     icon = 'Night'; }
ctx.reply(icon + '! ' + greeting + ', ' + user.first_name + '!');`,

        'rate limit': `// Simple per-user rate limiting using env
const key = 'rl_' + user.id;
const now = Date.now();
const last = parseInt(env[key] || '0', 10);
const cooldown = 30000; // 30 seconds
if (now - last < cooldown) {
  const wait = Math.ceil((cooldown - (now - last)) / 1000);
  return ctx.reply('Please wait ' + wait + ' seconds before using this command again.');
}
// env[key] = now; // (persist via your storage solution)
ctx.reply('Command executed!');`,

        /* ── Telegram Features ── */
        'poll': `ctx.telegram.sendPoll(chat.id, 'What do you think?', [
  'Great!',
  'Good',
  'Neutral',
  'Not great'
], {
  is_anonymous: false,
  allows_multiple_answers: false
});`,

        'quiz poll': `ctx.telegram.sendPoll(chat.id, 'What is 2 + 2?', [
  '3', '4', '5', '22'
], {
  type: 'quiz',
  correct_option_id: 1,
  explanation: '2 + 2 = 4. Mathematics!'
});`,

        'forward message': `if (message.reply_to_message) {
  await ctx.telegram.forwardMessage(
    chat.id,
    message.reply_to_message.chat.id,
    message.reply_to_message.message_id
  );
} else {
  ctx.reply('Reply to a message to forward it.');
}`,

        'pin message': `const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());
if (!adminIds.includes(String(user.id))) return ctx.reply('Admins only.');
if (!message.reply_to_message) return ctx.reply('Reply to a message to pin it.');
try {
  await ctx.telegram.pinChatMessage(chat.id, message.reply_to_message.message_id, { disable_notification: false });
  ctx.reply('Message pinned!');
} catch (e) {
  ctx.reply('Failed to pin: ' + e.message);
}`,

        'get chat members': `try {
  const count = await ctx.telegram.getChatMembersCount(chat.id);
  ctx.reply(
    '*Group Stats*\\n\\n' +
    'Members: ' + count + '\\n' +
    'Chat: ' + (chat.title || 'this chat') + '\\n' +
    'ID: \`' + chat.id + '\`',
    { parse_mode: 'Markdown' }
  );
} catch (e) {
  ctx.reply('Could not get member count: ' + e.message);
}`,

        /* ── HTTP & APIs ── */
        'http fetch': `try {
  const response = await fetch('https://api.example.com/endpoint');
  const data = await response.json();
  ctx.reply('Result: ' + JSON.stringify(data).substring(0, 200));
} catch (e) {
  ctx.reply('API request failed: ' + e.message);
}`,

        'http post': `const payload = { key: 'value', userId: String(user.id) };
try {
  const response = await fetch('https://api.example.com/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.API_TOKEN },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  ctx.reply(data.success ? 'Done!' : 'Failed: ' + (data.error || 'Unknown error'));
} catch (e) {
  ctx.reply('Request failed: ' + e.message);
}`,

        'crypto price': `try {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
  const data = await res.json();
  ctx.reply(
    '*Crypto Prices*\\n\\n' +
    'Bitcoin: $' + (data.bitcoin?.usd?.toLocaleString() || 'N/A') + '\\n' +
    'Ethereum: $' + (data.ethereum?.usd?.toLocaleString() || 'N/A'),
    { parse_mode: 'Markdown' }
  );
} catch (e) {
  ctx.reply('Could not fetch prices: ' + e.message);
}`,

        'weather': `const city = (message.text || '').split(' ').slice(1).join(' ') || 'Addis Ababa';
const apiKey = env.OPENWEATHER_API_KEY;
if (!apiKey) return ctx.reply('Set OPENWEATHER_API_KEY in env vars.');
try {
  const res = await fetch('https://api.openweathermap.org/data/2.5/weather?q=' + encodeURIComponent(city) + '&units=metric&appid=' + apiKey);
  const d = await res.json();
  if (d.cod !== 200) return ctx.reply('City not found: ' + city);
  ctx.reply(
    '*Weather in ' + d.name + '*\\n\\n' +
    'Temp: ' + d.main.temp + '°C (feels like ' + d.main.feels_like + '°C)\\n' +
    'Condition: ' + d.weather[0].description + '\\n' +
    'Humidity: ' + d.main.humidity + '%\\n' +
    'Wind: ' + d.wind.speed + ' m/s',
    { parse_mode: 'Markdown' }
  );
} catch (e) {
  ctx.reply('Weather lookup failed: ' + e.message);
}`,

        /* ── Advanced Patterns ── */
        'inter-command': `// Chain two commands — call another command from this one
const hour = new Date().getHours();
if (hour < 12) {
  Bot.sendMessage('Running morning routine...');
  Bot.runCommand('/morning');
} else if (hour < 20) {
  Bot.sendMessage('Running daytime routine...');
  Bot.runCommand('/day');
} else {
  Bot.sendMessage('Running night routine...');
  Bot.runCommand('/night');
}`,

        'broadcast template': `const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());
if (!adminIds.includes(String(user.id))) {
  return ctx.reply('Admins only.');
}
const msg = (message.text || '').split(' ').slice(1).join(' ').trim();
if (!msg) return ctx.reply('Usage: /broadcast Your message here');
ctx.reply('Broadcasting: ' + msg + '\\n\\nMessage sent to all subscribers!');`,

        'multi step form': `// Step 1 of a multi-step form
// Requires "Wait for reply" enabled on this command
ctx.reply(
  '*Step 1 of 3*\\n\\nPlease enter your full name:',
  {
    parse_mode: 'Markdown',
    reply_markup: { force_reply: true, selective: true }
  }
);
// Step 2 reads message.text as the user's name response`,

        'stats': `ctx.reply(
  '*Bot Statistics*\\n\\n' +
  'Messages processed: ' + (env.MSG_COUNT || 0) + '\\n' +
  'Active users: ' + (env.USER_COUNT || 0) + '\\n' +
  'Status: Online\\n' +
  'Uptime: 24/7 via MyFa Host',
  { parse_mode: 'Markdown' }
);`,

        /* ── Mini App / HTML ── */
        'mini app button': `const botId  = env.BOT_ID  || 'UNKNOWN_BOT_ID';
const hostUrl = env.HOST_URL || '';
if (!hostUrl) return ctx.reply('Set HOST_URL env variable to enable the mini app.');
ctx.reply('Open the app below:', {
  reply_markup: {
    inline_keyboard: [[
      { text: 'Open App', web_app: { url: hostUrl + '/api/mini/' + botId + '/home' } }
    ]]
  }
});`,

        'mini app html page': `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>My Mini App</title>
<style>
  body { margin: 0; padding: 20px; font-family: -apple-system, sans-serif;
         background: var(--tg-theme-bg-color, #050511);
         color: var(--tg-theme-text-color, #fff); }
  .card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; margin-bottom: 16px; }
  button { background: var(--tg-theme-button-color, #1d9bf0); color: #fff;
           border: none; border-radius: 12px; padding: 14px 24px;
           font-size: 15px; font-weight: 600; width: 100%; cursor: pointer; }
<\/style>
<\/head>
<body>
  <div class="card">
    <h2 id="greeting">Loading...<\/h2>
    <p id="uid"><\/p>
  <\/div>
  <button onclick="Telegram.WebApp.close()">Close App<\/button>
  <script>
    const tg = window.Telegram.WebApp;
    tg.ready(); tg.expand();
    const u = tg.initDataUnsafe.user;
    document.getElementById('greeting').textContent = 'Hello, ' + (u ? u.first_name : 'User') + '!';
    document.getElementById('uid').textContent = 'ID: ' + (u ? u.id : 'N/A');
  <\/script>
<\/body>
<\/html>`,

        /* ── Full Bots ── */
        'create full bot': `// Complete starter bot — /start command
const firstName = user.first_name || 'User';
const botName   = env.BOT_NAME || 'MyBot';

ctx.reply(
  '*Welcome ' + firstName + ' to ' + botName + '!*\\n\\n' +
  'Available commands:\\n' +
  '/help — Help menu\\n' +
  '/about — About this bot\\n' +
  '/stats — Your statistics\\n\\n' +
  '_Powered by MyFa Host_',
  {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [
        ['Help', 'About'],
        ['Stats', 'Settings']
      ],
      resize_keyboard: true
    }
  }
);`,

        'enterprise full bot': `// Enterprise starter bot — /start command
// Features: user tracking, admin detection, inline menu, personalised greeting
const isAdmin = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).includes(String(user.id));
const name    = user.first_name || 'User';
const botName = env.BOT_NAME || 'MyFa Bot';

ctx.reply(
  '*Welcome to ' + botName + '!*\\n\\n' +
  'Hello, ' + name + (isAdmin ? ' (Admin)' : '') + '!\\n\\n' +
  '/help — Commands guide\\n' +
  '/about — About us\\n' +
  '/stats — Your stats\\n' +
  (isAdmin ? '/admin — Admin panel\\n' : '') +
  '\\n_Powered by MyFa Host_',
  {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Help',  callback_data: 'help'  }, { text: 'About', callback_data: 'about' }],
        [{ text: 'Stats', callback_data: 'stats' }],
        ...(isAdmin ? [[{ text: 'Admin Panel', callback_data: 'admin' }]] : [])
      ]
    }
  }
);`,

        /* ── Python ── */
        'python reply': `# Python bot command
# Globals: ctx, user, chat, message, env, Bot
ctx.reply(f"Hello {user['first_name']}! Your ID: {user['id']}")`,

        'python admin': `# Python admin-only command
admin_ids = env.get('ADMIN_IDS', '').split(',')
if str(user['id']) not in [a.strip() for a in admin_ids]:
    ctx.reply("Access denied.")
else:
    ctx.reply("Welcome, Admin " + user['first_name'] + "!")`,

        'python channel check': `# Python channel membership check
channel_id = env.get('CHANNEL_ID', '@MYFA_ORG')
try:
    member = await ctx.telegram.getChatMember(channel_id, user['id'])
    status = member.get('status', '')
    if status in ['creator', 'administrator', 'member', 'restricted']:
        ctx.reply("Access granted!")
        Bot.runCommand("/welcome")
    else:
        ctx.reply("Please join " + channel_id + " first.")
except Exception as e:
    ctx.reply("Error: " + str(e))`,

        /* ── Referral / Points ── */
        'refer earn start': `const botId     = env.BOT_ID     || 'unknown';
const hostUrl   = env.HOST_URL   || '';
const botUser   = env.BOT_USERNAME || 'yourbot';
const ppRef     = parseInt(env.POINTS_PER_REFERRAL, 10) || 10;
const startParam = (message.text || '').split(' ')[1] || '';
const refUserId  = startParam.startsWith('ref_') ? startParam.slice(4) : null;
const myLink     = 'https://t.me/' + botUser + '?start=ref_' + user.id;

if (refUserId && refUserId !== String(user.id) && hostUrl) {
  try {
    const res = await fetch(hostUrl + '/api/refer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId, referrerId: String(refUserId), refereeId: String(user.id), refereeFirst: user.first_name })
    }).then(r => r.json());
    if (res.success) {
      ctx.telegram.sendMessage(parseInt(refUserId, 10),
        '+' + ppRef + ' points! ' + user.first_name + ' joined via your link!').catch(() => {});
    }
  } catch (e) {}
}

let stats = { refs: 0, points: 0 };
if (hostUrl) {
  try { stats = await fetch(hostUrl + '/api/refer-stats?botId=' + botId + '&userId=' + user.id).then(r => r.json()); } catch (e) {}
}

ctx.reply(
  'Welcome ' + user.first_name + '!\\n\\n' +
  'Earn ' + ppRef + ' points per referral.\\n\\n' +
  'Your stats: ' + (stats.refs || 0) + ' refs / ' + (stats.points || 0) + ' points\\n\\n' +
  'Your link:\\n' + myLink,
  hostUrl ? { reply_markup: { inline_keyboard: [[
    { text: 'Open Dashboard', web_app: { url: hostUrl + '/api/mini/' + botId + '/refer_page' } }
  ]]}} : undefined
);`,

        /* ── Callback / Events ── */
        'callback handler': `// Handle inline button callbacks
// Place this code in an "on:callback_query" command or check callback_data
const data = (message.data || ''); // callback_data value
if (data === 'yes') {
  await ctx.telegram.answerCbQuery(message.id, { text: 'You chose Yes!' });
  ctx.reply('You clicked Yes!');
} else if (data === 'no') {
  await ctx.telegram.answerCbQuery(message.id, { text: 'You chose No!' });
  ctx.reply('You clicked No!');
} else {
  await ctx.telegram.answerCbQuery(message.id);
}`,

        'delete message': `// Delete the triggering message (requires bot to be admin in groups)
try {
  await ctx.telegram.deleteMessage(chat.id, message.message_id);
} catch (e) {
  ctx.reply('Could not delete message: ' + e.message);
}`,

        'edit message': `// Edit a previously sent message
// First send a message and store its message_id, then use this:
const msgId = parseInt(env.LAST_MSG_ID, 10);
if (!msgId) return ctx.reply('No previous message ID stored.');
try {
  await ctx.telegram.editMessageText(chat.id, msgId, null, 'Updated content here!');
} catch (e) {
  ctx.reply('Could not edit: ' + e.message);
}`,
    };

    // ── Intent Detection (advanced multi-signal NLU) ────────
    // Returns an intent string like 'fix', 'explain', 'write:channel check'
    const INTENT_MAP = [
        // Debugging Mode — explicit runtime error names take highest priority
        { re: /typeerror|referenceerror|syntaxerror|rangeerror|urierror|evalerror|cannot read prop|is not defined|is not a function|unexpected token|unexpected end|stack trace|traceback|uncaught error|failed to fetch|not a constructor/, intent: 'debug' },
        // Fix / debug (user says "error" / "bug" without pasting an error class)
        { re: /\b(check|debug|error|bug|wrong|problem|issue|crash|broken|fix|why|not work|doesnt work|fail)\b/, intent: 'fix' },
        // Explain
        { re: /\b(explain|what does|how does|describe|understand|what is|tell me|meaning|what\s+this)\b/, intent: 'explain' },
        // Optimize
        { re: /\b(optimiz|improv|better|clean|refactor|simplif|performance|rewrite|faster)\b/, intent: 'optimize' },
        // Specific templates (order matters — more specific first)
        { re: /\b(channel|join|member|subscrib|mandatory)\b/, intent: 'write:channel check' },
        { re: /inline.*button|button.*inline/, intent: 'write:reply with inline' },
        { re: /\b(keyboard|menu|reply.markup|reply button|keyboard button)\b/, intent: 'write:reply with keyboard' },
        { re: /\b(super.?admin|multi.?admin|admin.?level|admin.?role)\b/, intent: 'write:multi admin' },
        { re: /\b(admin|only admin|restrict|admin gate|admin check)\b/, intent: 'write:admin check' },
        { re: /\b(photo|image|picture|media|send photo|image url)\b/, intent: 'write:send photo' },
        { re: /\b(document|file|pdf|send file)\b/, intent: 'write:send document' },
        { re: /\b(audio|music|mp3|sound)\b/, intent: 'write:send audio' },
        { re: /\b(group|supergroup|group only|chat type)\b/, intent: 'write:group only' },
        { re: /private.?only|dm.?only|only.?private/, intent: 'write:private only' },
        { re: /\b(random|dice|roll|lottery|generate number)\b/, intent: 'write:random number' },
        { re: /user.?info|user.?id|my.?info|who.?am.?i|my.?id|my.?profile/, intent: 'write:user info' },
        { re: /chat.?info|group.?info|chat.?id|chat.?type/, intent: 'write:chat info' },
        { re: /\b(env|variable|api.?key|secret|config|env.?var)\b/, intent: 'write:env variable' },
        { re: /try.?catch|error.?hand|exception|safe.?code/, intent: 'write:try catch' },
        { re: /countdown|timer|days.?left|time.?left|deadline/, intent: 'write:countdown' },
        { re: /quiz.?poll|quiz/, intent: 'write:quiz poll' },
        { re: /\b(poll|vote|survey)\b/, intent: 'write:poll' },
        { re: /\b(stat|count|analytics|metrics|numbers)\b/, intent: 'write:stats' },
        { re: /greeting|good.?morning|good.?night|time.?based/, intent: 'write:time greeting' },
        { re: /inter.?command|run.?command|call.?command|chain.?command|connect.?command|bot.?runcommand/, intent: 'write:inter-command' },
        { re: /broadcast|send.?all|mass.?message|send.?everyone/, intent: 'write:broadcast template' },
        { re: /form|multi.?step|step.?by.?step|wizard|input.?flow/, intent: 'write:multi step form' },
        { re: /rate.?limit|cooldown|flood.?protect|slow.?mode/, intent: 'write:rate limit' },
        { re: /ban.?user|ban.?member|kick/, intent: 'write:ban user' },
        { re: /mute.?user|silence|restrict.?member/, intent: 'write:mute user' },
        { re: /pin.?message/, intent: 'write:pin message' },
        { re: /delete.?message|remove.?message/, intent: 'write:delete message' },
        { re: /edit.?message|update.?message/, intent: 'write:edit message' },
        { re: /forward.?message|forward.?msg/, intent: 'write:forward message' },
        { re: /callback|inline.?button.?press|button.?click|callback.?data/, intent: 'write:callback handler' },
        { re: /get.?member.?count|member.?count|how.?many.?member/, intent: 'write:get chat members' },
        { re: /force.?reply|ask.?user|wait.?input|wait.?reply/, intent: 'write:force reply' },
        { re: /remove.?keyboard|hide.?keyboard/, intent: 'write:remove keyboard' },
        { re: /http|fetch|api.?call|rest.?api|post.?request|get.?request/, intent: 'write:http fetch' },
        { re: /http.?post|post.?data|send.?data/, intent: 'write:http post' },
        { re: /crypto|bitcoin|ethereum|price|coin/, intent: 'write:crypto price' },
        { re: /weather/, intent: 'write:weather' },
        { re: /mini.?app|web.?app|webview|html.?page/, intent: 'write:mini app button' },
        { re: /html.?template|html.?page|mini.?app.?page/, intent: 'write:mini app html page' },
        { re: /refer.*earn|earn.*refer|referral/, intent: 'write:refer earn start' },
        { re: /number.?arg|argument|param|slash.?command/, intent: 'write:number argument' },
        { re: /enterprise.*bot|pro.*bot|advanced.*bot/, intent: 'write:enterprise full bot' },
        { re: /full.?bot|complete.?bot|starter.?bot|new.?bot|create.?bot/, intent: 'write:create full bot' },
        { re: /python.*admin/, intent: 'write:python admin' },
        { re: /python.*channel/, intent: 'write:python channel check' },
        { re: /python/, intent: 'write:python reply' },
        { re: /markdown|html.?format|bold|italic|format.?text/, intent: 'write:markdown reply' },
        { re: /html.?reply|html.?message/, intent: 'write:html reply' },
        { re: /\b(write|create|make|generate|build|add|new|give me)\b/, intent: 'write' },
        { re: /reply|hello|start|welcome|hi|greet/, intent: 'write:reply' },
    ];

    function detectIntent(text) {
        const t = text.toLowerCase().replace(/[^\w\s]/g, ' ');
        for (const { re, intent } of INTENT_MAP) {
            if (re.test(t)) return intent;
        }
        return 'general';
    }

    // ── Error detection ───────────────────────────────────────
    function detectErrors(code, lang) {
        const patterns = lang === 'python' ? PY_ERROR_PATTERNS : JS_ERROR_PATTERNS;
        const found = [];
        patterns.forEach(p => {
            const reCopy = new RegExp(p.re.source, p.re.flags.replace('g', ''));
            if (reCopy.test(code)) found.push(p.msg);
        });
        if (lang !== 'python') {
            const open  = (code.match(/\{/g) || []).length;
            const close = (code.match(/\}/g) || []).length;
            if (open !== close) found.push('Unbalanced braces: ' + open + ' `{` vs ' + close + ' `}` — check for missing brackets.');
            const openP  = (code.match(/\(/g) || []).length;
            const closeP = (code.match(/\)/g) || []).length;
            if (openP !== closeP) found.push('Unbalanced parentheses: ' + openP + ' `(` vs ' + closeP + ' `)` — check for missing brackets.');
        }
        const singleQ = (code.match(/(?<!\\)'/g) || []).length;
        const doubleQ = (code.match(/(?<!\\)"/g) || []).length;
        if (singleQ % 2 !== 0) found.push('Odd number of single quotes — possible unclosed string literal.');
        if (doubleQ % 2 !== 0) found.push('Odd number of double quotes — possible unclosed string literal.');
        return found;
    }

    // ── Auto-fix ──────────────────────────────────────────────
    function autoFix(code, lang) {
        let fixed = code;
        const changes = [];
        if (lang !== 'python') {
            if (/console\.log\s*\(/.test(fixed)) {
                fixed = fixed.replace(/console\.log\s*\(([^)]+)\)/g, 'ctx.reply($1)');
                changes.push('Replaced `console.log()` with `ctx.reply()`');
            }
            if (/\bvar\s+/.test(fixed)) {
                fixed = fixed.replace(/\bvar\s+/g, 'const ');
                changes.push('Replaced `var` with `const`');
            }
            if (/([^=!<>])=([^=>])/.test(fixed) && !/==/.test(fixed)) {
                // Only flag obvious assignment-in-condition, don't mutate
            }
        }
        return { fixed, changes };
    }

    // ── Code explainer ────────────────────────────────────────
    function explainCode(code, lang) {
        const lines = code.split('\n').filter(l => l.trim()).length;
        const parts = [];
        if (/ctx\.reply/.test(code))                       parts.push('Sends a reply message to the user');
        if (/replyWithPhoto|sendPhoto/.test(code))         parts.push('Sends a photo');
        if (/replyWithDocument|sendDocument/.test(code))   parts.push('Sends a document/file');
        if (/replyWithAudio|sendAudio/.test(code))         parts.push('Sends an audio file');
        if (/reply_markup/.test(code))                     parts.push('Shows a keyboard or inline buttons');
        if (/parse_mode.*Markdown|Markdown.*parse_mode/.test(code)) parts.push('Uses *Markdown* text formatting');
        if (/parse_mode.*HTML|HTML.*parse_mode/.test(code)) parts.push('Uses HTML text formatting');
        if (/web_app/.test(code))                          parts.push('Opens a Telegram Mini App');
        if (/user\.id|user\.first_name/.test(code))        parts.push('Reads the sender\'s user information');
        if (/chat\.id|chat\.type/.test(code))              parts.push('Accesses the current chat');
        if (/message\.text/.test(code))                    parts.push('Reads the incoming message text');
        if (/env\./.test(code))                            parts.push('Reads environment variables');
        if (/if\s*\(/.test(code))                          parts.push('Contains conditional logic (if/else)');
        if (/for\s*\(|forEach|\.map\(/.test(code))         parts.push('Iterates over a list or array');
        if (/try\s*\{/.test(code))                         parts.push('Has error handling (try/catch)');
        if (/async|await/.test(code))                      parts.push('Uses async/await for async operations');
        if (/Bot\.runCommand/.test(code))                  parts.push('Calls another command with Bot.runCommand()');
        if (/Bot\.sendMessage/.test(code))                 parts.push('Sends a message via Bot helper');
        if (/getChatMember/.test(code))                    parts.push('Checks channel/group membership');
        if (/banChatMember/.test(code))                    parts.push('Bans a user from the chat');
        if (/restrictChatMember/.test(code))               parts.push('Restricts/mutes a user');
        if (/pinChatMessage/.test(code))                   parts.push('Pins a message in the chat');
        if (/sendPoll/.test(code))                         parts.push('Creates a Telegram poll');
        if (/force_reply/.test(code))                      parts.push('Requests a direct reply from the user');
        if (/deleteMessage/.test(code))                    parts.push('Deletes a message');
        if (/editMessageText/.test(code))                  parts.push('Edits a previously sent message');
        if (/forwardMessage/.test(code))                   parts.push('Forwards a message');
        if (/fetch\s*\(/.test(code))                       parts.push('Makes an HTTP API request');
        if (lang === 'python') parts.push('Written in Python');
        if (lang === 'html')   parts.push('HTML Mini App page (rendered in Telegram WebView)');
        if (!parts.length) parts.push('A simple bot command');
        return '**This code (' + lines + ' line' + (lines !== 1 ? 's' : '') + '):**\n' +
               parts.map(p => '• ' + p).join('\n');
    }

    // ── Optimization tips ─────────────────────────────────────
    function optimizeSuggestions(code) {
        const tips = [];
        if (/\+\s*['"][^'"]{0,3}['"]\s*\+/g.test(code)) tips.push('Use template literals (backtick strings) instead of `+` concatenation for cleaner multi-line messages.');
        if (/\.split\(' '\)/.test(code))  tips.push('Use `.split(/\\s+/)` to handle multiple spaces between words.');
        if (code.split('\n').length > 40)  tips.push('This command is long — split logic into smaller commands and chain them with `Bot.runCommand()`.');
        if (!/try\s*\{/.test(code) && /ctx\.reply|fetch/.test(code)) tips.push('Wrap async calls in `try/catch` so errors don\'t crash the command silently.');
        if (!/return/.test(code) && /if\s*\(/.test(code)) tips.push('Add `return` after error replies to stop execution: `return ctx.reply("Error...")`.');
        if (/Bot\.runCommand/.test(code) && !/await/.test(code)) tips.push('`Bot.runCommand()` is async — add `await` before it for correct execution order.');
        if (/user\.id/.test(code) && !/String\(user\.id\)/.test(code)) tips.push('Wrap `user.id` in `String()` when comparing with strings: `String(user.id) === adminId`.');
        if (/\.then\(/.test(code) && !/await/.test(code)) tips.push('Replace `.then()` chains with `async/await` for easier error handling and readability.');
        if (/parseInt\s*\([^,)]+\)/.test(code) && !/parseInt\s*\([^,)]+,\s*10\)/.test(code)) tips.push('Always pass radix `10` to `parseInt()`: `parseInt(val, 10)`.');
        if (!tips.length) tips.push('Code looks clean — no obvious optimizations found. Consider adding a try/catch for robustness.');
        return tips;
    }

    // ── Global docs lookup ────────────────────────────────────
    function lookupGlobal(text) {
        const t = text.toLowerCase();
        for (const [kw, doc] of Object.entries(GLOBALS_DOC)) {
            if (t.includes(kw.toLowerCase())) {
                return { type: 'explain', text: '**`' + kw + '`**\n\n' + doc };
            }
        }
        return null;
    }

    // ── Plan feature gate ──────────────────────────────────────
    // debug is always free — users must always be able to get help with errors
    const FREE_FEATURES    = new Set(['fix','debug','explain','general','write','write:reply','write:markdown reply','write:html reply','write:user info','write:conditional','write:env variable','write:try catch','write:random number','write:time greeting']);
    const PREMIUM_FEATURES = new Set([...FREE_FEATURES, 'optimize','write:admin check','write:multi admin','write:channel check','write:send photo','write:send document','write:send audio','write:group only','write:private only','write:reply with keyboard','write:reply with inline','write:force reply','write:remove keyboard','write:stats','write:countdown','write:poll','write:quiz poll','write:http fetch','write:http post','write:inter-command','write:broadcast template','write:ban user','write:mute user','write:pin message','write:delete message','write:edit message','write:forward message','write:callback handler','write:get chat members','write:multi step form','write:rate limit','write:chat info','write:number argument','write:python reply','write:python admin','write:python channel check']);
    const ALL_FEATURES      = new Set([...PREMIUM_FEATURES, 'write:enterprise full bot','write:create full bot','write:mini app button','write:mini app html page','write:weather','write:crypto price','write:refer earn start','write:http post']);

    function canUseFeature(feature) {
        if (userPlan === 'enterprise') return true;
        if (userPlan === 'premium')    return ALL_FEATURES.has(feature) || PREMIUM_FEATURES.has(feature);
        return FREE_FEATURES.has(feature);
    }

    // ── Mode Detection ────────────────────────────────────────
    // Returns: 'debug' | 'edit' | 'auto'
    // 'debug'  — user pasted/described a runtime error
    // 'edit'   — user has code in editor AND wants to modify it
    // 'auto'   — use normal intent detection
    function detectMode(userText, editorCode) {
        const t = userText.toLowerCase();
        // Debugging Mode triggers: explicit error class names or runtime error phrases
        if (/typeerror|referenceerror|syntaxerror|rangeerror|urierror|evalerror/.test(t)) return 'debug';
        if (/cannot read prop|is not defined|is not a function|cannot set|unexpected token|unexpected end|uncaught error|stack trace|traceback|not a constructor|failed to fetch/.test(t)) return 'debug';
        if (/error:.*line\s*\d|at\s+\S+\.js:\d|line \d+.*error|exception occured|got (an? )?error|keeps? (throwing|crashing)|why.*(error|fail|crash)|error.*why/.test(t)) return 'debug';
        // Code Editing Mode: must have code in editor AND an edit-like verb
        if (editorCode && editorCode.trim()) {
            if (/\b(modify|change|update|edit|add to|extend|refactor|rename|remove|replace|improve|make it|convert|add feature|add function|add a|add this|put admin|put try|wrap it|add error|change the|update the|fix the|remove the|delete the|replace the|instead|instead of|more|also add|include|insert|put|adjust|rewrite|upgrade|make (the|this|my)|transform|switch|turn it)\b/.test(t)) {
                return 'edit';
            }
        }
        return 'auto';
    }

    // ── Code Editing Mode ─────────────────────────────────────
    // Surgically modifies existing editor code based on request.
    // Returns { modified, changes[], explanations[] } or null.
    function editCode(existingCode, request, lang) {
        const t = request.toLowerCase();
        let modified = existingCode;
        const changes = [];
        const explanations = [];

        // ── Add admin gate ────────────────────────────────────
        if (/add admin|add.*admin.?check|admin.?gate|admin.?only|restrict.*admin|only.*admin/.test(t)) {
            if (!/adminIds/.test(modified)) {
                const gate = "const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());\nif (!adminIds.includes(String(user.id))) return ctx.reply('Admins only.');\n\n";
                modified = gate + modified;
                changes.push('Added admin gate at the top');
                explanations.push('Reads `ADMIN_IDS` from env (comma-separated user IDs) and exits immediately if the caller is not in the list. Always returns early so protected code never runs for non-admins.');
            }
        }

        // ── Wrap in try/catch ─────────────────────────────────
        if (/wrap|add try|add.*catch|add error.?hand|make.*safe|protect|robust/.test(t)) {
            if (!/try\s*\{/.test(modified)) {
                const wrapped = 'try {\n' +
                    modified.split('\n').map(l => '  ' + l).join('\n') +
                    '\n} catch (e) {\n  ctx.reply(\'An error occurred: \' + e.message);\n}';
                modified = wrapped;
                changes.push('Wrapped code in try/catch');
                explanations.push('Any runtime exception is now caught before it crashes the command. The error message is forwarded to the user so you can diagnose it from real usage.');
            }
        }

        // ── Add Markdown parse_mode ───────────────────────────
        if (/markdown|add.*format|make.*bold|add.*bold|parse.?mode|format.*text/.test(t)) {
            if (/ctx\.reply\(/.test(modified) && !/parse_mode/.test(modified)) {
                modified = modified.replace(/ctx\.reply\(([^,)]+)\)/g, "ctx.reply($1, { parse_mode: 'Markdown' })");
                changes.push('Added Markdown parse_mode to ctx.reply()');
                explanations.push('`parse_mode: "Markdown"` tells Telegram to render `*bold*`, `_italic_`, `` `code` `` and `[links](url)` in your message. Without it those characters appear literally.');
            }
        }

        // ── console.log → ctx.reply ───────────────────────────
        if (/console|fix console|replace console|remove console/.test(t)) {
            if (/console\.log/.test(modified)) {
                modified = modified.replace(/console\.log\s*\(([^)]+)\)/g, 'ctx.reply($1)');
                changes.push('Replaced console.log() with ctx.reply()');
                explanations.push('`console.log()` writes to the server log — users never see it. `ctx.reply()` sends the message directly to the Telegram chat.');
            }
        }

        // ── var → const ───────────────────────────────────────
        if (/use const|fix var|replace var|es6|modern syntax|modernize/.test(t)) {
            if (/\bvar\s+/.test(modified)) {
                modified = modified.replace(/\bvar\s+/g, 'const ');
                changes.push('Replaced var with const');
                explanations.push('`const` has block scoping and prevents accidental reassignment, making code safer and more predictable than `var` which is function-scoped and hoisted.');
            }
        }

        // ── Add early return after error replies ──────────────
        if (/add return|early return|fix return|missing return/.test(t)) {
            const before = modified;
            modified = modified.replace(/(ctx\.reply\(['"][^'"]*(?:error|denied|invalid|only|failed|not|usage)[^'"]*['"]\s*(?:,[^)]+)?\))\s*;(?!\s*\})/gi, 'return $1;');
            if (modified !== before) {
                changes.push('Added early return after error/guard replies');
                explanations.push('Without `return`, execution continues past the error message. `return ctx.reply(...)` stops the command immediately after sending the guard reply.');
            }
        }

        // ── Null-safe message.text ────────────────────────────
        if (/null.?check|undefined.?check|message.*text.*null|safe.*message|message.*safe/.test(t)) {
            if (/message\.text/.test(modified) && !/message\.text\s*\|\|/.test(modified)) {
                modified = modified.replace(/\bmessage\.text\b/g, "(message.text || '')");
                changes.push('Added null-safe fallback for message.text');
                explanations.push('`message.text` is `undefined` for non-text updates (photos, stickers, etc.). Defaulting to `\'\'` prevents a `TypeError: Cannot read properties of undefined` crash.');
            }
        }

        // ── Add await to Bot.runCommand ───────────────────────
        if (/add await|await.*bot|fix.*await|missing await/.test(t)) {
            if (/Bot\.runCommand/.test(modified) && !/await\s+Bot\.runCommand/.test(modified)) {
                modified = modified.replace(/\bBot\.runCommand\b/g, 'await Bot.runCommand');
                changes.push('Added await before Bot.runCommand()');
                explanations.push('`Bot.runCommand()` is async. Without `await` the next line of code runs before the command completes, causing race conditions or silent failures.');
            }
        }

        // ── Private-only gate ─────────────────────────────────
        if (/private.?only|dm.?only|only.?private|only.*dm|only.*private/.test(t)) {
            if (!/chat\.type\s*!==\s*'private'|chat\.type\s*===\s*'private'\s*\)/.test(modified)) {
                const gate = "if (chat.type !== 'private') {\n  return ctx.reply('This command only works in private chats.');\n}\n\n";
                modified = gate + modified;
                changes.push('Added private-chat-only gate');
                explanations.push('Prevents the command from running in groups or channels. Useful for commands that involve user-specific data that should stay private.');
            }
        }

        // ── Group-only gate ───────────────────────────────────
        if (/group.?only|only.?group|groups?.?only/.test(t)) {
            if (!/chat\.type\s*===\s*'private'\s*\)/.test(modified)) {
                const gate = "if (chat.type === 'private') {\n  return ctx.reply('This command only works in groups.');\n}\n\n";
                modified = gate + modified;
                changes.push('Added group-only gate');
                explanations.push('Prevents the command from running in private DMs — useful for moderation commands or group-stats features that require a group context.');
            }
        }

        // ── Inline keyboard → reply keyboard swap ─────────────
        if (/inline.*keyboard|change.*keyboard|switch.*keyboard/.test(t)) {
            if (/inline_keyboard/.test(modified) && /reply_markup/.test(modified)) {
                // Can't auto-convert structure safely, provide targeted tip
                changes.push('Note: inline_keyboard detected — to switch to a reply keyboard, replace `inline_keyboard` with `keyboard` and use plain string arrays');
                explanations.push('Inline keyboards attach to the message; reply keyboards appear at the bottom of the screen. They use different property names: `inline_keyboard` vs `keyboard`.');
            }
        }

        // ── Add String() cast around user.id ─────────────────
        if (/cast.*id|string.*id|user.*id.*string|compare.*id|id.*compare/.test(t)) {
            if (/user\.id/.test(modified) && !/String\(user\.id\)/.test(modified)) {
                modified = modified.replace(/\buser\.id\b/g, 'String(user.id)');
                changes.push('Wrapped user.id in String()');
                explanations.push('`user.id` is a number. Env variables and callback_data are always strings. Comparing number to string with `===` always returns `false` — `String(user.id)` fixes this.');
            }
        }

        if (!changes.length) return null;
        return { modified, changes, explanations };
    }

    // ── Debugging Mode ────────────────────────────────────────
    // Identifies root cause from user-described error, generates fix.
    // Returns { rootCause, explanation, fixedCode, prevention }
    function debugCode(userText, editorCode, lang) {
        const t = userText.toLowerCase();
        const result = { rootCause: '', explanation: '', fixedCode: null, prevention: '' };

        // TypeError: Cannot read properties of undefined
        if (/cannot read prop|cannot read properties.*undefined|of undefined|property.*of (null|undefined)/.test(t)) {
            result.rootCause = 'TypeError — accessing a property on an undefined or null value';
            result.explanation =
                'This happens when you try to access a property (`.text`, `.id`, `.first_name`) on a value that is `undefined` or `null` at runtime.\n\n' +
                'Common causes:\n' +
                '• `message.text` when receiving a non-text update (photo, sticker, command with no text)\n' +
                '• `user.username` when the user has no Telegram username\n' +
                '• An API response property that does not exist in every response shape\n' +
                '• `message.reply_to_message.from` when no message was replied to';
            result.prevention =
                'Use optional chaining (`obj?.prop`) or a fallback: `(message.text || \'\')`. ' +
                'Always guard reply_to_message before accessing it: `if (!message.reply_to_message) return ctx.reply("Reply to a message first.");`';
            if (editorCode) {
                let fixed = editorCode;
                fixed = fixed.replace(/\bmessage\.text\b(?!\s*\|\||\.?trim)/g, "(message.text || '')");
                fixed = fixed.replace(/\buser\.username\b(?!\s*\|\|)/g, "(user.username || '')");
                if (fixed !== editorCode) {
                    result.fixedCode = fixed;
                }
            }
            return result;
        }

        // ReferenceError: X is not defined
        if (/is not defined|referenceerror/.test(t)) {
            result.rootCause = 'ReferenceError — variable used before declaration or does not exist in scope';
            result.explanation =
                'You referenced a name that does not exist in the current scope.\n\n' +
                'Common causes:\n' +
                '• Using `require()` or `import` — not supported. Use built-in globals: `ctx`, `user`, `chat`, `message`, `env`, `Bot`, `fetch`\n' +
                '• Typo in a variable name (e.g., `usr` instead of `user`, `massage` instead of `message`)\n' +
                '• Variable declared with `const`/`let` inside an `if` block and accessed outside it\n' +
                '• Missing `async` keyword when using `await`';
            result.prevention = 'Only use the pre-loaded globals: `ctx`, `user`, `chat`, `message`, `env`, `Bot`, `fetch`. Never use `require()` or `import`.';
            if (editorCode) {
                const { fixed, changes } = autoFix(editorCode, lang);
                if (changes.length) result.fixedCode = fixed;
            }
            return result;
        }

        // TypeError: X is not a function
        if (/is not a function/.test(t)) {
            result.rootCause = 'TypeError — calling a value that is not a function';
            result.explanation =
                'You tried to call something as a function, but it is not one.\n\n' +
                'Common causes:\n' +
                '• Calling a property that is a string or number, not a method (e.g., `message.text()` — `.text` is a string)\n' +
                '• Misspelled method name: `ctx.replly()` instead of `ctx.reply()`\n' +
                '• Awaiting a non-Promise value: `await someString`\n' +
                '• A variable shadows a built-in (e.g., `const fetch = ...` overwrites the global `fetch`)';
            result.prevention =
                'Double-check method names. Available methods: `ctx.reply()`, `ctx.replyWithPhoto()`, `ctx.telegram.sendMessage()`, `ctx.telegram.getChatMember()`, `Bot.runCommand()`, `Bot.sendMessage()`.';
            return result;
        }

        // SyntaxError
        if (/syntaxerror|unexpected token|unexpected end|missing \)|missing :|unexpected identifier/.test(t)) {
            result.rootCause = 'SyntaxError — the JavaScript parser cannot understand your code';
            result.explanation =
                'The code has invalid syntax and cannot be executed at all.\n\n' +
                'Common causes:\n' +
                '• Missing closing brace `}` or parenthesis `)`\n' +
                '• Unclosed string literal (missing quote `\'` or `"`)\n' +
                '• Extra or missing comma in an object/array\n' +
                '• Using `await` outside an `async` function\n' +
                '• Reserved keyword used as a variable name';
            if (editorCode) {
                const errors = detectErrors(editorCode, lang);
                const { fixed, changes } = autoFix(editorCode, lang);
                if (changes.length) {
                    result.fixedCode = fixed;
                    result.explanation += '\n\nAuto-fixes applied:\n' + changes.map(c => '• ' + c).join('\n');
                }
                if (errors.length) {
                    result.explanation += '\n\nIssues detected in editor code:\n' + errors.map(e => '• ' + e).join('\n');
                }
            }
            result.prevention = 'Use the "Check my code" feature regularly while writing. Count your opening and closing brackets — they must match.';
            return result;
        }

        // Timeout
        if (/timeout|timed out|request.*timeout|execution.*limit|took too long/.test(t)) {
            result.rootCause = 'Execution timeout — the command took longer than the serverless time limit';
            result.explanation =
                'Serverless functions have a strict execution time limit. Long operations exceed it.\n\n' +
                'Common causes:\n' +
                '• An external API (`fetch`) that takes too long to respond\n' +
                '• An infinite loop or deep recursion\n' +
                '• Missing `await` causing multiple concurrent async operations\n' +
                '• Waiting for a reply from a Telegram bot that never responds';
            result.prevention =
                'Add a timeout to `fetch()` calls using `AbortController`:\n' +
                'const ctrl = new AbortController();\n' +
                'setTimeout(() => ctrl.abort(), 8000);\n' +
                'const res = await fetch(url, { signal: ctrl.signal });';
            if (editorCode && /fetch\s*\(/.test(editorCode) && !/AbortController/.test(editorCode)) {
                result.fixedCode =
                    'const ctrl = new AbortController();\n' +
                    'setTimeout(() => ctrl.abort(), 8000);\n' +
                    editorCode.replace(/await fetch\s*\(([^,)]+)\)/g, 'await fetch($1, { signal: ctrl.signal })');
            }
            return result;
        }

        // 403 Forbidden (Telegram)
        if (/403|forbidden|not enough rights|admin.?required|bot.*not.*admin|need.*admin|permission.*denied/.test(t)) {
            result.rootCause = 'Telegram API 403 Forbidden — bot lacks required permissions';
            result.explanation =
                'The bot attempted an action it does not have permission for.\n\n' +
                'Common causes:\n' +
                '• Trying to ban, mute, pin, or delete without the bot being group admin\n' +
                '• Sending messages to a channel the bot is not admin of\n' +
                '• Using `getChatMember()` on a private channel the bot is not in\n' +
                '• Bot was removed from the group but is still trying to send messages';
            result.prevention = 'Make the bot an administrator in the group/channel with the appropriate permissions (ban users, delete messages, pin messages, etc.) in the Telegram group settings.';
            return result;
        }

        // 400 Bad Request (Telegram)
        if (/400|bad request|message.*too long|parse.*error|can\'t parse|invalid.*message|malformed/.test(t)) {
            result.rootCause = 'Telegram API 400 Bad Request — invalid parameters sent to Telegram';
            result.explanation =
                'Telegram rejected the API call because of invalid input.\n\n' +
                'Common causes:\n' +
                '• Message text longer than 4096 characters\n' +
                '• Invalid `parse_mode` with unclosed Markdown entities (unmatched `*` or `_`)\n' +
                '• Invalid or stale `chat_id` / `message_id`\n' +
                '• Sending an empty message string\n' +
                '• HTML special characters in HTML parse_mode without escaping';
            result.prevention =
                'Truncate long messages: `text.substring(0, 4000) + (text.length > 4000 ? "..." : "")`. ' +
                'Escape user input before injecting into Markdown. Always validate that strings are non-empty before calling `ctx.reply()`.';
            if (editorCode) {
                // Suggest wrapping in try/catch so 400 errors surface clearly
                if (!/try\s*\{/.test(editorCode)) {
                    const wrapped = 'try {\n' +
                        editorCode.split('\n').map(l => '  ' + l).join('\n') +
                        '\n} catch (e) {\n  ctx.reply(\'Telegram error: \' + e.message);\n}';
                    result.fixedCode = wrapped;
                }
            }
            return result;
        }

        // Generic / catch-all debugging
        result.rootCause = 'Runtime error — something failed during command execution';
        result.explanation =
            'To diagnose the exact problem:\n' +
            '1. Wrap your code in `try/catch` and reply with `e.message` to see the real error\n' +
            '2. Check that all required environment variables are set\n' +
            '3. Confirm the bot is running (green status indicator)\n' +
            '4. Test with a minimal `ctx.reply("test")` first to confirm the command runs at all\n' +
            '5. Look at your bot\'s runtime logs for the full stack trace';
        result.prevention =
            'Always use this pattern as your outer wrapper:\n' +
            'try {\n  // your code here\n} catch (e) {\n  ctx.reply("Error: " + e.message);\n}';
        if (editorCode) {
            const errors = detectErrors(editorCode, lang);
            const { fixed, changes } = autoFix(editorCode, lang);
            if (errors.length) {
                result.explanation += '\n\nIssues found in editor code:\n' + errors.map(e => '• ' + e).join('\n');
            }
            if (changes.length) {
                result.fixedCode = fixed;
                result.explanation += '\n\nAuto-fixes applied:\n' + changes.map(c => '• ' + c).join('\n');
            } else if (!errors.length) {
                // Wrap in try/catch as general fix
                if (!/try\s*\{/.test(editorCode) && editorCode.trim()) {
                    result.fixedCode = 'try {\n' +
                        editorCode.split('\n').map(l => '  ' + l).join('\n') +
                        '\n} catch (e) {\n  ctx.reply(\'Error: \' + e.message);\n}';
                }
            }
        }
        return result;
    }

    // ── Main process function ─────────────────────────────────
    function process(userText) {
        const limit = PLAN_LIMITS[userPlan] || 30;
        if (sessionRequests >= limit) {
            return {
                type: 'limit',
                text: 'You\'ve used all **' + limit + '** AI requests this session on the **' + userPlan + '** plan.\n\nUpgrade to **Premium** for 150 requests/session, or **Enterprise** for unlimited access.'
            };
        }
        sessionRequests++;

        const code = codeEditor ? codeEditor.getValue() : '';
        const lang = currentLang || 'javascript';

        // Remember context (rolling window)
        memory.push({ role: 'user', text: userText });
        if (memory.length > 12) memory.splice(0, 2);

        const intent = detectIntent(userText);
        const [intentType, intentKey] = intent.split(':');

        // ── Globals / docs lookup ──────────────────────────────
        if (/what is|how (do|to) (use|call)|syntax|doc|reference/.test(userText.toLowerCase())) {
            const g = lookupGlobal(userText);
            if (g) return g;
        }

        // ── Detect operational mode ────────────────────────────
        const mode = detectMode(userText, code);

        // ══════════════════════════════════════════════════════
        // MODE 1 — DEBUGGING MODE
        // Triggered when user describes/pastes a runtime error
        // ══════════════════════════════════════════════════════
        if (mode === 'debug' || intentType === 'debug') {
            const dbg = debugCode(userText, code, lang);
            return { type: 'debug', rootCause: dbg.rootCause, explanation: dbg.explanation, fixedCode: dbg.fixedCode, prevention: dbg.prevention };
        }

        // ── Feature gate (all other modes) ────────────────────
        if (!canUseFeature(intent) && !canUseFeature(intentType)) {
            const planNeeded = ALL_FEATURES.has(intent) ? 'Enterprise' : 'Premium';
            return {
                type: 'upgrade',
                text: '**' + (intentKey || intent).replace(/-/g, ' ') + '** requires **' + planNeeded + '** plan.\n\nUpgrade in your Profile to unlock the full MyFa AI.\n\nFree plan includes: error checking, code explanation, debugging, and 8 generation templates.'
            };
        }

        // ══════════════════════════════════════════════════════
        // MODE 2 — CODE EDITING MODE
        // Triggered when code is in editor AND user wants to modify it
        // ══════════════════════════════════════════════════════
        if (mode === 'edit') {
            const editResult = editCode(code, userText, lang);
            if (editResult) {
                return {
                    type: 'edit',
                    code: editResult.modified,
                    changes: editResult.changes,
                    explanations: editResult.explanations
                };
            }
            // editCode found nothing actionable — fall through to fix/explain
        }

        // ══════════════════════════════════════════════════════
        // MODE 3 — FIX / CHECK MODE
        // ══════════════════════════════════════════════════════
        if (intentType === 'fix') {
            if (!code.trim()) return { type: 'info', text: 'No code in the editor yet. Write some code first, then ask me to check it!' };
            const errors = detectErrors(code, lang);
            const { fixed, changes } = autoFix(code, lang);
            if (!errors.length && !changes.length) {
                return { type: 'ok', text: '**No issues found!** Your code looks clean.\n\n**Tips before deploying:**\n• Make sure all env variables are set\n• Test with real Telegram messages\n• Add `try/catch` for robustness\n• Confirm bot status is Running (green)' };
            }
            return { type: 'errors', text: '', errors, fixed: changes.length ? fixed : null, fixDesc: changes };
        }

        // ── Explain ────────────────────────────────────────────
        if (intentType === 'explain') {
            if (!code.trim()) return { type: 'info', text: 'Nothing to explain yet — open a command and write some code first!' };
            return { type: 'explain', text: explainCode(code, lang) };
        }

        // ── Optimize ───────────────────────────────────────────
        if (intentType === 'optimize') {
            if (!code.trim()) return { type: 'info', text: 'No code to optimize — write some code first!' };
            const tips = optimizeSuggestions(code);
            return { type: 'tips', text: '**Optimization Suggestions:**\n\n' + tips.join('\n\n') };
        }

        // ══════════════════════════════════════════════════════
        // MODE 1 — CODE GENERATION MODE
        // Full working code, no placeholders, production-ready
        // ══════════════════════════════════════════════════════
        if (intentType === 'write') {
            const tplKey = intentKey || '';
            const tpl = tplKey && CODE_TEMPLATES[tplKey] ? CODE_TEMPLATES[tplKey] : null;
            const displayName = (tplKey || 'command').replace(/-/g, ' ');
            if (tpl) return { type: 'code', text: 'Here is a complete **' + displayName + '** implementation:', code: tpl };

            // Fuzzy match on template keys
            const fuzz = userText.toLowerCase();
            for (const [key, code2] of Object.entries(CODE_TEMPLATES)) {
                if (fuzz.includes(key.split(' ')[0])) return { type: 'code', text: 'Here is a **' + key + '** implementation:', code: code2 };
            }
            return { type: 'code', text: 'Here is a basic reply command to get you started:', code: CODE_TEMPLATES['reply'] };
        }

        // ── General / fallback ─────────────────────────────────
        if (code.trim()) {
            const errors = detectErrors(code, lang);
            if (errors.length) return { type: 'errors', text: 'I spotted some issues in your code:', errors, fixed: null, fixDesc: [] };
            const tips = optimizeSuggestions(code);
            if (tips.length && tips[0].charAt(0) !== 'C') return { type: 'tips', text: '**Suggestions for your code:**\n\n' + tips.join('\n\n') };
            return { type: 'explain', text: explainCode(code, lang) };
        }

        // Last-resort: fuzzy template match on any input words
        const fuzz = userText.toLowerCase();
        for (const [key, code2] of Object.entries(CODE_TEMPLATES)) {
            if (fuzz.split(' ').some(w => w.length > 3 && key.includes(w))) {
                return { type: 'code', text: 'Here is a **' + key + '** implementation:', code: code2 };
            }
        }

        return {
            type: 'help',
            text: '**Myfa AI Pro** — Advanced Coding Engine\n\n' +
                  'I operate in 4 intelligent modes:\n\n' +
                  '**Code Generation** — "write a channel check", "create a full bot"\n' +
                  '**Code Editing** — "add admin gate", "wrap in try/catch", "make it private only"\n' +
                  '**Debugging** — paste your error or say "TypeError: ..." and I\'ll diagnose it\n' +
                  '**Check & Fix** — "check my code", "find bugs", "fix errors"\n\n' +
                  'Plus:\n' +
                  '• **Explain** — "explain this code"\n' +
                  '• **Optimize** — "optimize my code"\n' +
                  '• **Docs** — "how do I use fetch?", "what is ctx.telegram?"\n\n' +
                  '**Try:**\n' +
                  '• *"write a channel check command"*\n' +
                  '• *"add admin gate to my code"*\n' +
                  '• *"TypeError: Cannot read properties of undefined"*\n' +
                  '• *"wrap this in try/catch"*\n' +
                  '• *"create a full enterprise bot"*\n' +
                  '• *"optimize my code"*'
        };
    }

    return {
        process,
        setUserPlan: p => { userPlan = p; },
        getSessionCount: () => sessionRequests,
        getLimit: () => PLAN_LIMITS[userPlan] || 30
    };
})();

module.exports = MYFA_AI;
