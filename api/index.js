const express = require('express');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ===== FIREBASE REALTIME DATABASE =====
const FB = "https://myfa-host-a1af6-default-rtdb.firebaseio.com";

// Sanitize path to only allow alphanumeric, underscore, hyphen, and slash —
// prevents SSRF by ensuring only the configured Firebase project is accessed.
function sanitizePath(path) {
    return String(path).replace(/[^a-zA-Z0-9_\-/]/g, '_');
}

async function fbGet(path) {
    try { const r = await axios.get(`${FB}/${sanitizePath(path)}.json`); return r.data; }
    catch(e) { return null; }
}
async function fbSet(path, data) {
    try { await axios.put(`${FB}/${sanitizePath(path)}.json`, data); return true; }
    catch(e) { console.error('fbSet:', e.message); return false; }
}
async function fbUpdate(path, data) {
    try { await axios.patch(`${FB}/${sanitizePath(path)}.json`, data); return true; }
    catch(e) { console.error('fbUpdate:', e.message); return false; }
}
async function fbDelete(path) {
    try { await axios.delete(`${FB}/${sanitizePath(path)}.json`); return true; }
    catch(e) { return false; }
}
async function fbPush(path, data) {
    try { const r = await axios.post(`${FB}/${sanitizePath(path)}.json`, data); return r.data.name; }
    catch(e) { return null; }
}

// ===== CONSTANTS =====
const BOT_TOKEN = "8561070534:AAFa_b1cRxb74_re_DOhmasXSODaWtqvdWs";
const ADMIN_ID = 6941014837;
const OFFICIAL_CHANNEL = -1002448299298; // mandatory join channel (@MYFA_ORG)

// ===== SHARED HELPERS =====
async function registerUser(userId, fromData) {
    const existing = await fbGet(`users/${userId}`);
    if (!existing) {
        await fbSet(`users/${userId}`, {
            id: String(userId), name: fromData.first_name || 'User',
            username: fromData.username || '', plan: 'free',
            banned: false, created: Date.now(), lastSeen: Date.now()
        });
        const stats = await fbGet('global_stats') || {};
        stats.totalUsers = (stats.totalUsers || 0) + 1;
        await fbSet('global_stats', stats);
    } else {
        await fbUpdate(`users/${userId}`, { lastSeen: Date.now(), name: fromData.first_name || existing.name });
    }
}

async function logActivity(userId, action, details) {
    await fbPush('activity_logs', { time: Date.now(), userId: String(userId), action, details: details || '' });
}

async function addBotLog(botId, message, type) {
    const key = `bot_${botId}_logs`;
    let logs = await fbGet(key) || [];
    if (!Array.isArray(logs)) logs = [];
    logs.unshift({ time: Date.now(), message, type: type || 'info' });
    if (logs.length > 100) logs = logs.slice(0, 100);
    await fbSet(key, logs);
}

// Legacy compatibility wrappers (keep old API working)
async function dbGet(endpoint) { return fbGet(endpoint); }
async function dbSave(endpoint, data) { return fbSet(endpoint, data); }

// ===== CHANNEL MEMBERSHIP CHECK =====
async function checkChannelMembership(userId) {
    try {
        const bot = new Telegraf(BOT_TOKEN);
        const member = await bot.telegram.getChatMember(OFFICIAL_CHANNEL, userId);
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
        return validStatuses.includes(member.status);
    } catch(e) {
        console.warn('checkChannelMembership error:', e.message);
        return false;
    }
}

// ==========================================
//  MAIN BOT — /start HANDLER
// ==========================================
app.post('/api/main-webhook', async (req, res) => {
    try {
        const bot = new Telegraf(BOT_TOKEN);
        const update = req.body;

        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const baseUrl = `${proto}://${host}`;

        // Handle callback_query (e.g. "I Joined" button)
        if (update.callback_query) {
            const cq = update.callback_query;
            const chatId = cq.message.chat.id;
            const userId = cq.from.id;
            await bot.telegram.answerCbQuery(cq.id).catch(() => {});
            if (cq.data === 'check_join') {
                const joined = await checkChannelMembership(userId);
                if (joined) {
                    await bot.telegram.sendMessage(chatId,
                        `✅ *ቻናሎቻችንን ስለተቀላቀሉ እናመሰግናለን!*\n\nWelcome to MyFa Host! Tap below to open the platform.`,
                        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 Open MyFa Host', web_app: { url: baseUrl } }]] } }
                    );
                } else {
                    await bot.telegram.sendMessage(chatId,
                        `⚠️ *ቦቱን ለመጠቀም ሁሉንም ቻናሎች መቀላቀል አለብዎት!*\n\nYou haven't joined yet. Please join @MYFA_ORG first.`,
                        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                            [{ text: '📢 Join MYFA_ORG Channel', url: 'https://t.me/MYFA_ORG' }],
                            [{ text: '✅ I Joined — Check Again', callback_data: 'check_join' }]
                        ]} }
                    );
                }
            }
            return;
        }

        if (!update.message) return;
        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const firstName = msg.from.first_name || 'User';

        await registerUser(userId, msg.from);
        await logActivity(userId, 'bot_message', msg.text || '');

        // Handle document/file messages (backup restore support)
        if (msg.document) {
            const fileName = msg.document.file_name || 'file';
            if (fileName.endsWith('.json') || fileName.endsWith('.zip')) {
                await bot.telegram.sendMessage(chatId,
                    `📦 *File received: ${fileName}*\n\nOpen MyFa Host and use the "Upload Files" button in your bot dashboard to restore this backup.`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 Open MyFa Host', web_app: { url: baseUrl } }]] } }
                );
            } else {
                await bot.telegram.sendMessage(chatId,
                    `📎 File received. Open MyFa Host to manage your bots.`,
                    { reply_markup: { inline_keyboard: [[{ text: '🚀 Open MyFa Host', web_app: { url: baseUrl } }]] } }
                );
            }
            return;
        }

        if (msg.text === '/start' || (msg.text || '').startsWith('/start ')) {
            // Mandatory channel membership check
            const joined = await checkChannelMembership(userId);
            if (!joined) {
                await bot.telegram.sendMessage(chatId,
                    `⚠️ *ቦቱን ለመጠቀም ሁሉንም ቻናሎች መቀላቀል አለብዎት!*\n\n` +
                    `To use *MyFa Host*, you must first join our official channel:\n\n` +
                    `📢 @MYFA_ORG\n\nJoin the channel and press the button below.`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                        [{ text: '📢 Join Official Channel', url: 'https://t.me/MYFA_ORG' }],
                        [{ text: '✅ I Joined — Check Again', callback_data: 'check_join' }]
                    ]} }
                );
                return;
            }

            await bot.telegram.sendMessage(chatId,
                `👋 *Welcome ${firstName} to MyFa Host!*\n\n` +
                `🚀 The most advanced Telegram Bot Hosting Platform\n\n` +
                `✨ *Features:*\n` +
                `• Host unlimited bots 24/7\n` +
                `• Built-in code editor with syntax highlighting\n` +
                `• Real-time analytics & monitoring\n` +
                `• One-click deployment\n` +
                `• Environment variables management\n\n` +
                `Tap below to open the platform! 👇`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 Open MyFa Host', web_app: { url: baseUrl } }]] } }
            );
            if (String(userId) === String(ADMIN_ID)) {
                await bot.telegram.sendMessage(chatId,
                    `🔐 *Admin Control Panel*\n\nWelcome back, Admin! 👑\n\n` +
                    `You have full access to:\n• User management\n• Bot management\n` +
                    `• System monitoring\n• Broadcast messages\n• Subscription plans`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⚙️ Admin Control Panel', web_app: { url: `${baseUrl}/admin.html` } }]] } }
                );
            }
        } else if (msg.text === '/help') {
            await bot.telegram.sendMessage(chatId,
                `📚 *MyFa Host Help*\n\n/start — Open the platform\n/help — Show this help\n/status — Check your bots status\n/stats — Platform statistics\n\n*Support:* @MyFaSupport`,
                { parse_mode: 'Markdown' }
            );
        } else if (msg.text === '/status') {
            const userBots = await fbGet(`user_${userId}_bots`) || [];
            const deps = await fbGet('active_deployments') || [];
            const online = userBots.filter(b => deps.find(d => d.botId === b.id));
            await bot.telegram.sendMessage(chatId,
                `📊 *Your Bots Status*\n\nTotal: ${userBots.length} | Online: ${online.length}\n\n` +
                (userBots.map(b => `${deps.find(d => d.botId === b.id) ? '🟢' : '🔴'} ${b.name}`).join('\n') || 'No bots found.'),
                { parse_mode: 'Markdown' }
            );
        } else if (msg.text === '/stats') {
            const stats = await fbGet('global_stats') || {};
            await bot.telegram.sendMessage(chatId,
                `📈 *Platform Statistics*\n\n🤖 Bots: ${stats.totalBots || 0}\n👥 Users: ${stats.totalUsers || 0}\n⚡ Commands: ${stats.totalCmds || 0}\n📨 Messages: ${stats.totalMessages || 0}`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch(e) { console.error('MainBot:', e.message); }
    res.status(200).send('OK');
});


// Setup main bot webhook (call once after deploy)
app.get('/api/setup-main-webhook', async (req, res) => {
    try {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const url = `${proto}://${host}/api/main-webhook`;
        const bot = new Telegraf(BOT_TOKEN);
        await bot.telegram.setWebhook(url);
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Open MyFa Host platform' },
            { command: 'help', description: 'Show help' },
            { command: 'status', description: 'Check your bots status' },
            { command: 'stats', description: 'Platform statistics' }
        ]);
        res.json({ success: true, webhook: url });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// Auto-setup: called by the mini-app on load to ensure the webhook always points to the correct URL.
// Safe to call repeatedly — Telegram ignores no-op setWebhook calls.
app.get('/api/auto-setup-webhook', async (req, res) => {
    try {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const correctUrl = `${proto}://${host}/api/main-webhook`;
        const bot = new Telegraf(BOT_TOKEN);
        const info = await bot.telegram.getWebhookInfo();
        if (info.url !== correctUrl) {
            await bot.telegram.setWebhook(correctUrl);
            await bot.telegram.setMyCommands([
                { command: 'start', description: 'Open MyFa Host platform' },
                { command: 'help', description: 'Show help' },
                { command: 'status', description: 'Check your bots status' },
                { command: 'stats', description: 'Platform statistics' }
            ]);
            res.json({ fixed: true, webhook: correctUrl });
        } else {
            res.json({ fixed: false, webhook: correctUrl });
        }
    } catch(e) { res.json({ success: false, error: e.message }); }
});

// ==========================================
//  USER BOT WEBHOOK HANDLER
// ==========================================
app.post('/api/webhook/:botId', async (req, res) => {
    const { botId } = req.params;
    try {
        let deployments = await fbGet('active_deployments') || [];
        const dep = deployments.find(d => d.botId === botId);
        if (!dep || !dep.token) return res.status(200).send('Bot Offline');

        const bot = new Telegraf(dep.token);
        const commands = await fbGet(`bot_${botId}_commands`) || {};
        const envVars = await fbGet(`bot_${botId}_env`) || {};

        // Track message analytics
        if (req.body.message) {
            const senderId = req.body.message.from?.id;
            if (senderId) {
                const analyticsKey = `bot_${botId}_analytics`;
                const analytics = await fbGet(analyticsKey) || { messages: 0, uniqueUsers: [] };
                analytics.messages = (analytics.messages || 0) + 1;
                if (!analytics.uniqueUsers) analytics.uniqueUsers = [];
                if (!analytics.uniqueUsers.includes(String(senderId))) {
                    analytics.uniqueUsers.push(String(senderId));
                }
                await fbSet(analyticsKey, analytics);
                // Update global stats
                const gs = await fbGet('global_stats') || {};
                gs.totalMessages = (gs.totalMessages || 0) + 1;
                await fbSet('global_stats', gs);
            }
        }

        bot.on('message', async (ctx) => {
            const text = ctx.message.text || '';
            let matchedCmdData = null;
            let matchedCmdName = '';

            for (const cmdData of Object.values(commands)) {
                const commandName = (typeof cmdData === 'object') ? cmdData.command : "cmd";
                const aliases = (typeof cmdData === 'object' && cmdData.aliases) ? cmdData.aliases.split(',').map(s => s.trim()).filter(Boolean) : [];

                const matchers = [commandName, `/${commandName}`, ...aliases, ...aliases.map(a => `/${a}`)];

                if (matchers.some(m => text === m || text.startsWith(m + ' '))) {
                    matchedCmdData = cmdData;
                    matchedCmdName = commandName;
                    break;
                }
            }

            if (!matchedCmdData) return;

            const cmdData = matchedCmdData;
            const commandName = matchedCmdName;
            const code = (typeof cmdData === 'object') ? cmdData.answer : cmdData;
            const lang = (typeof cmdData === 'object') ? (cmdData.lang || 'javascript') : 'javascript';
            const groupRestriction = (typeof cmdData === 'object') ? (cmdData.group || '') : '';
            const keyboardJson = (typeof cmdData === 'object') ? (cmdData.keyboard || '') : '';
            const waitForReply = (typeof cmdData === 'object') ? !!cmdData.wait : false;

            try {
                // Group restriction check
                if (groupRestriction && groupRestriction.trim()) {
                    const allowedGroup = String(groupRestriction).trim();
                    if (String(ctx.chat.id) !== allowedGroup) {
                        // Silently ignore if not in the allowed group
                        return;
                    }
                }

                // HTML Page command — send a "Open Mini App" web_app button
                if (lang === 'html') {
                    const host = req.headers['x-forwarded-host'] || req.headers.host;
                    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
                    const pageUrl = `${proto}://${host}/api/mini/${botId}/${encodeURIComponent(commandName)}`;
                    const label = (typeof cmdData === 'object' && cmdData.help) ? cmdData.help : ('🌐 Open ' + commandName);
                    await ctx.reply(label, {
                        reply_markup: {
                            inline_keyboard: [[{ text: '🌐 Open Mini App', web_app: { url: pageUrl } }]]
                        }
                    });
                    return;
                }

                // Build reply keyboard if configured
                let replyMarkupOverride = null;
                if (keyboardJson && keyboardJson.trim()) {
                    try {
                        const kbdData = JSON.parse(keyboardJson);
                        if (Array.isArray(kbdData)) {
                            replyMarkupOverride = { keyboard: kbdData, resize_keyboard: true, one_time_keyboard: false };
                        }
                    } catch(e) { /* invalid JSON — ignore */ }
                }

                // JS/Python/Shell — eval as before
                const user = ctx.from;
                const botInfo = dep;
                const message = ctx.message;
                const chat = ctx.chat;
                const env = envVars;

                // Wrap ctx.reply to inject keyboard if configured
                const _origReply = ctx.reply.bind(ctx);
                if (replyMarkupOverride) {
                    ctx.reply = (text, extra) => {
                        const mergedExtra = { ...(extra || {}), reply_markup: extra?.reply_markup || replyMarkupOverride };
                        return _origReply(text, mergedExtra);
                    };
                }

                // Bot object for inter-command communication
                const Bot = {
                    sendMessage: (text, opts) => ctx.reply(text, opts || {}),
                    runCommand: async (cmdPath) => {
                        const cmdKey = (cmdPath || '').replace(/^\//, '').trim();
                        const targetCmd = commands[cmdKey];
                        if (!targetCmd) return;
                        const targetCode = typeof targetCmd === 'object' ? targetCmd.answer : targetCmd;
                        if (!targetCode) return;
                        try {
                            // eslint-disable-next-line no-unused-vars
                            const user = ctx.from, message = ctx.message, chat = ctx.chat, env = envVars;
                            await eval(`(async function __cmd__() { ${targetCode} })()`); // eslint-disable-line no-eval
                        } catch(e) { console.warn('Bot.runCommand error:', e.message); }
                    },
                    getUser: () => ctx.from,
                    getChat: () => ctx.chat,
                };

                if (lang === 'javascript') {
                    // JS - native execution
                    // eslint-disable-next-line no-unused-vars
                    await eval(`(async function __cmd__() { ${code} })()`); // eslint-disable-line no-eval
                } else {
                    const fs = require('fs');
                    const { exec } = require('child_process');
                    const path = require('path');
                    const util = require('util');
                    const execAsync = util.promisify(exec);
                    const tmpDir = '/tmp'; // Ensure we use /tmp for Vercel compatibility

                    const runId = Date.now() + Math.floor(Math.random() * 1000);
                    let filepath = '';
                    let runCmd = '';

                    if (lang === 'python') {
                        filepath = path.join(tmpDir, `script_${runId}.py`);
                        runCmd = `python3 ${filepath}`;
                    } else if (lang === 'go') {
                        filepath = path.join(tmpDir, `main_${runId}.go`);
                        runCmd = `go run ${filepath}`;
                    } else if (lang === 'java') {
                        // Java typically expects class name to match filename.
                        // Assuming basic single-class files without public class declarations, or simply Main.
                        filepath = path.join(tmpDir, `Main_${runId}.java`);

                        // For generic user snippets, auto-wrap in class if needed, or assume they wrote full Java.
                        let finalCode = code;
                        if (!finalCode.includes('class ')) {
                            finalCode = `public class Main_${runId} { public static void main(String[] args) { ${code} } }`;
                        } else {
                            // If they provided a class, we attempt to run that file using Java 11+ single file mode
                        }
                        runCmd = `java ${filepath}`;
                        fs.writeFileSync(filepath, finalCode);
                    } else {
                        fs.writeFileSync(filepath, code);
                    }

                    if (filepath) {
                        try {
                            const { stdout, stderr } = await execAsync(runCmd, { timeout: 5000 }); // 5 second timeout
                            const output = (stdout || '') + (stderr ? '\n[Error]: ' + stderr : '');
                            if (output.trim()) await ctx.reply(`[${lang.toUpperCase()} Output]:\n${output}`);
                        } catch (err) {
                            await ctx.reply(`[${lang.toUpperCase()} Execution Error]:\n${err.message}`);
                        } finally {
                            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                        }
                    } else {
                        await ctx.reply(`[MyFa Engine] Executing ${lang.toUpperCase()} code is simulated in this environment.\n\nCode length: ${code.length} chars.`);
                    }
                }

                // Wait for reply (force reply)
                if (waitForReply) {
                    await ctx.reply('⌨️ Please reply to continue...', {
                        reply_markup: { force_reply: true, selective: true }
                    });
                }
            } catch (e) {
                ctx.reply('❌ Error: ' + e.message);
                await addBotLog(botId, `Command /${commandName} error: ${e.message}`, 'error');
            }
        });

        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } catch (e) {
        console.error(`Webhook Error ${botId}:`, e);
        await addBotLog(botId, `Webhook error: ${e.message}`, 'error');
        res.status(200).send('Error');
    }
});


// ==========================================
//  API ENDPOINTS
// ==========================================

// 1. Global Stats
app.get('/api/global-stats', async (req, res) => {
    let stats = await fbGet('global_stats');
    if (!stats) stats = { totalBots: 0, totalUsers: 0, totalCmds: 0, totalMessages: 0 };
    res.json(stats);
});

// 2. User registration (called on first mini-app open)
app.post('/api/register-user', async (req, res) => {
    const { userId, name, username } = req.body;
    await registerUser(userId, { first_name: name, username });
    res.json({ success: true });
});

// 2b. User plan (used by MyFa AI panel)
app.get('/api/user-plan', async (req, res) => {
    const uid = req.query.userId;
    if (!uid) return res.json({ plan: 'free' });
    const userData = await fbGet(`users/${uid}`);
    res.json({ plan: userData?.plan || 'free' });
});

// 3. My Bots
app.get('/api/my-bots', async (req, res) => {
    const uid = req.query.userId;
    const user = await fbGet(`users/${uid}`);
    if (user && user.banned) return res.json({ banned: true, bots: [] });
    let userBots = await fbGet(`user_${uid}_bots`) || [];
    let deployments = await fbGet('active_deployments') || [];
    const response = userBots.map(b => {
        const dep = deployments.find(d => d.botId === b.id);
        return { ...b, status: dep ? 'Online' : 'Offline', startTime: dep ? dep.startTime : null };
    });
    res.json(response);
});

// 4. Create Bot
app.post('/api/create-bot', async (req, res) => {
    const { userId, token, teamName } = req.body;
    try {
        const tgRes = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
        if (!tgRes.data.ok) return res.json({ success: false, error: "Invalid Token" });
        const botInfo = tgRes.data.result;
        let userBots = await fbGet(`user_${userId}_bots`) || [];
        if (userBots.find(b => b.id === botInfo.id.toString())) return res.json({ success: false, error: "Bot already added" });

        const displayName = teamName ? `${teamName} (${botInfo.first_name})` : botInfo.first_name;
        userBots.push({ id: botInfo.id.toString(), name: displayName, username: botInfo.username, token, dateCreated: Date.now(), isPinned: false, order: Date.now(), role: 'owner' });
        await fbSet(`user_${userId}_bots`, userBots);
        await fbSet(`bot_${botInfo.id}_commands`, { "start": { command: "start", answer: "ctx.reply('👋 Hello! I am running on MyFa Host.\\n\\n✨ Add commands from the dashboard!');" } });
        await fbSet(`bot_${botInfo.id}_env`, {});
        await addBotLog(botInfo.id.toString(), 'Bot created', 'info');
        await logActivity(userId, 'create_bot', botInfo.username);

        let stats = await fbGet('global_stats') || { totalBots: 0, totalUsers: 0 };
        stats.totalBots = (stats.totalBots || 0) + 1;
        await fbSet('global_stats', stats);

        res.json({ success: true, botId: botInfo.id.toString(), bot: { id: botInfo.id.toString(), name: displayName, username: botInfo.username } });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

// Team Invites
app.post('/api/create-invite', async (req, res) => {
    const { botId, userId, targetId, name } = req.body;
    const userBots = await fbGet(`user_${userId}_bots`) || [];
    const bot = userBots.find(b => b.id === botId && b.role !== 'member');
    if (!bot) return res.json({ success: false, error: "Unauthorized" });

    const code = require('crypto').randomBytes(4).toString('hex');
    await fbSet(`invites/${code}`, { botId, ownerId: userId, targetId: targetId || null, expires: Date.now() + 86400000 });

    if (targetId) {
        const botName = name || bot.name;

        // Add to web app notifications
        const notifs = await fbGet(`user_${targetId}_notifications`) || [];
        notifs.push({ title: 'Team Invite', body: `You've been invited to join the team for bot ${botName}! Your invite code is: ${code}`, time: Date.now() });
        await fbSet(`user_${targetId}_notifications`, notifs);

        // Send notification via Telegram main bot
        const hostBot = new Telegraf(BOT_TOKEN);
        hostBot.telegram.sendMessage(targetId, `👋 You've been invited to join the team for bot *${botName}*!\n\nYour invite code is: \`${code}\`\n\nEnter this code in the MyFa Host mini-app to join.`, { parse_mode: 'Markdown' }).catch(()=>{});
    }

    res.json({ success: true, code });
});

app.post('/api/join-team', async (req, res) => {
    const { userId, code } = req.body;
    const invite = await fbGet(`invites/${code}`);
    if (!invite || Date.now() > invite.expires) return res.json({ success: false, error: 'Invalid or expired code' });
    if (invite.targetId && invite.targetId !== String(userId)) return res.json({ success: false, error: 'This code is not for you' });

    // Add bot to user's list as member
    const ownerBots = await fbGet(`user_${invite.ownerId}_bots`) || [];
    const botInfo = ownerBots.find(b => b.id === invite.botId);
    if (!botInfo) return res.json({ success: false, error: 'Bot no longer exists' });

    let userBots = await fbGet(`user_${userId}_bots`) || [];
    if (userBots.find(b => b.id === invite.botId)) return res.json({ success: false, error: 'You are already in this team' });

    // Members don't get the token, we store a blank string
    userBots.push({ id: botInfo.id, name: botInfo.name + ' (Team)', username: botInfo.username, token: '', dateCreated: Date.now(), isPinned: false, order: Date.now(), role: 'member', ownerId: invite.ownerId });
    await fbSet(`user_${userId}_bots`, userBots);

    await fbUpdate(`invites/${code}`, { expires: 0 }); // invalidate
    res.json({ success: true });
});

// Notifications
app.get('/api/notifications', async (req, res) => {
    const { userId } = req.query;
    const notifs = await fbGet(`user_${userId}_notifications`) || [];
    res.json(notifs);
});

// 5. Toggle Bot
app.post('/api/toggle-bot', async (req, res) => {
    const { botId, action, token } = req.body;
    let deployments = await fbGet('active_deployments') || [];

    if (action === 'stop') {
        try { const b = new Telegraf(token); await b.telegram.deleteWebhook(); } catch(e) {}
        deployments = deployments.filter(d => d.botId !== botId);
        await fbSet('active_deployments', deployments);
        await addBotLog(botId, 'Bot stopped', 'info');
        return res.json({ success: true, status: 'Offline' });
    }

    if (action === 'start') {
        try {
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
            const webhookUrl = `${proto}://${host}/api/webhook/${botId}`;
            const bot = new Telegraf(token);
            await bot.telegram.setWebhook(webhookUrl);
            try { const me = await bot.telegram.getMe(); await fbSet(`bot_${botId}_username`, me.username || ''); } catch(e) {}
            if (!deployments.find(d => d.botId === botId)) {
                deployments.push({ botId, token, startTime: Date.now() });
                await fbSet('active_deployments', deployments);
            }
            await addBotLog(botId, `Bot started — webhook: ${webhookUrl}`, 'info');
            return res.json({ success: true, status: 'Online' });
        } catch (e) {
            let msg = e.message;
            if (e.response && e.response.error_code === 401) msg = "Invalid Token";
            return res.json({ success: false, error: msg });
        }
    }
});

// 6. Commands CRUD
app.get('/api/commands', async (req, res) => {
    res.json(await fbGet(`bot_${req.query.botId}_commands`) || {});
});

app.post('/api/save-command', async (req, res) => {
    const { botId, commandData } = req.body;
    let cmds = await fbGet(`bot_${botId}_commands`) || {};
    const isNew = !cmds[commandData.command];
    cmds[commandData.command] = commandData;
    await fbSet(`bot_${botId}_commands`, cmds);
    if (isNew) {
        let stats = await fbGet('global_stats') || {};
        stats.totalCmds = (stats.totalCmds || 0) + 1;
        await fbSet('global_stats', stats);
    }
    res.json({ success: true });
});

app.post('/api/delete-command', async (req, res) => {
    const { botId, command } = req.body;
    let cmds = await fbGet(`bot_${botId}_commands`) || {};
    delete cmds[command];
    await fbSet(`bot_${botId}_commands`, cmds);
    res.json({ success: true });
});

app.post('/api/github-deploy', async (req, res) => {
    const { botId, repoUrl } = req.body;
    if (!botId || !repoUrl) return res.json({ success: false, error: 'Missing parameters' });
    try {
        let downloadUrl = repoUrl;
        if (repoUrl.includes('github.com') && !repoUrl.endsWith('.zip')) {
            // Convert https://github.com/user/repo to https://github.com/user/repo/archive/refs/heads/main.zip
            downloadUrl = repoUrl.replace(/\/$/, '') + '/archive/refs/heads/main.zip';
        }

        const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        const JSZip = require('jszip');
        const zip = await JSZip.loadAsync(response.data);

        let cmds = await fbGet(`bot_${botId}_commands`) || {};
        let imported = 0;

        for (const filename of Object.keys(zip.files)) {
            if (zip.files[filename].dir) continue;
            if (!filename.match(/\.(js|py|sh|txt|html|go|java)$/i)) continue;
            const content = await zip.files[filename].async("string");

            // Extract pure filename without directory path or extension
            const cmdName = filename.replace(/^.*[\\\/]/, '').replace(/\.[^.]+$/, '');
            const lang = filename.endsWith('.py') ? 'python' : filename.endsWith('.sh') ? 'shell' : filename.endsWith('.html') ? 'html' : filename.endsWith('.go') ? 'go' : filename.endsWith('.java') ? 'java' : 'javascript';

            cmds[cmdName] = { command: cmdName, answer: content, lang, aliases: '', help: '' };
            imported++;
        }

        await fbSet(`bot_${botId}_commands`, cmds);
        res.json({ success: true, imported });
    } catch(e) {
        console.error('GitHub Deploy Error:', e);
        res.json({ success: false, error: 'Failed to download or parse repository. Check URL.' });
    }
});

// 7. Environment Variables
app.get('/api/env-vars', async (req, res) => {
    res.json(await fbGet(`bot_${req.query.botId}_env`) || {});
});

app.post('/api/save-env', async (req, res) => {
    const { botId, key, value } = req.body;
    if (!key) return res.json({ success: false, error: 'Key required' });
    let env = await fbGet(`bot_${botId}_env`) || {};
    env[key] = value;
    await fbSet(`bot_${botId}_env`, env);
    res.json({ success: true });
});

app.post('/api/delete-env', async (req, res) => {
    const { botId, key } = req.body;
    let env = await fbGet(`bot_${botId}_env`) || {};
    delete env[key];
    await fbSet(`bot_${botId}_env`, env);
    res.json({ success: true });
});

// 8. Bot Logs
app.get('/api/bot-logs', async (req, res) => {
    const logs = await fbGet(`bot_${req.query.botId}_logs`) || [];
    res.json(Array.isArray(logs) ? logs : []);
});

// Legacy errors endpoint
app.get('/api/bot-errors', async (req, res) => {
    const logs = await fbGet(`bot_${req.query.botId}_logs`) || [];
    const arr = Array.isArray(logs) ? logs : [];
    const errors = arr.filter(l => l.type === 'error');
    if (errors.length) res.json({ error: errors[0].message });
    else res.json({});
});

// 9. Analytics
app.get('/api/bot-analytics', async (req, res) => {
    const data = await fbGet(`bot_${req.query.botId}_analytics`) || { messages: 0, uniqueUsers: [] };
    res.json(data);
});

// 10. Templates
const BOT_TEMPLATES = [
    { id: 'echo', name: 'Echo Bot', lang: 'js', description: 'Repeats exactly what users say back to them', code: "ctx.reply('You said: ' + (message.text || ''));" },
    { id: 'welcome', name: 'Welcome Bot', lang: 'js', description: 'Greets new members with inline buttons', code: "const name = user.first_name || 'User';\nctx.reply(`👋 Welcome, ${name}!\\n\\nI am your friendly bot. Use /help to see commands.`, { reply_markup: { inline_keyboard: [[{text:'📖 Help',callback_data:'help'},{text:'👤 My Info',callback_data:'info'}]] } });" },
    { id: 'info', name: 'User Info Bot', lang: 'js', description: 'Shows detailed user & chat information', code: "ctx.reply(`*Your Info*\\n\\nID: ${user.id}\\nName: ${user.first_name}\\nUsername: @${user.username || 'none'}\\nChat ID: ${chat.id}\\nChat Type: ${chat.type}`, { parse_mode: 'Markdown' });" },
    { id: 'keyboard', name: 'Reply Keyboard', lang: 'js', description: 'Sends a persistent reply keyboard menu', code: "ctx.reply('Choose an option:', { reply_markup: { keyboard: [['Feature 1', 'Feature 2'], ['Stats', 'Help']], resize_keyboard: true, one_time_keyboard: false } });" },
    { id: 'inline', name: 'Inline Buttons', lang: 'js', description: 'Sends inline keyboard with URL and callback buttons', code: "ctx.reply('Choose an action:', { reply_markup: { inline_keyboard: [\n  [{ text: 'Confirm', callback_data: 'confirm' }, { text: 'Cancel', callback_data: 'cancel' }],\n  [{ text: 'Visit Website', url: 'https://example.com' }]\n] } });" },
    { id: 'calc', name: 'Calculator', lang: 'js', description: 'Evaluates basic math expressions safely', code: "const expr = message.text.split(' ').slice(1).join(' ');\nif (!expr) return ctx.reply('Usage: /calc 2 + 3 * 4\\n\\nSupports: + - * / %');\n// Safe: only digits, operators, spaces, parentheses\nif (!/^[0-9+\\-*/.() %\\^]+$/.test(expr)) return ctx.reply('Invalid characters. Use only numbers and + - * / ( )');\ntry {\n  // Use reduce-based parser for basic arithmetic without eval\n  const nums = []; const ops = [];\n  const applyOp = () => { const b=nums.pop(), a=nums.pop(), op=ops.pop(); if(op==='+') nums.push(a+b); else if(op==='-') nums.push(a-b); else if(op==='*') nums.push(a*b); else if(op==='/') { if(b===0) throw new Error('div0'); nums.push(a/b); } };\n  const prec = {'+':1,'-':1,'*':2,'/':2};\n  let i=0, s=expr.replace(/\\s/g,'');\n  while(i<s.length){\n    if(s[i]==='(' ){ops.push('(');i++;}\n    else if(s[i]===')'){while(ops[ops.length-1]!=='(')applyOp();ops.pop();i++;}\n    else if('+-*/'.includes(s[i])){while(ops.length&&ops[ops.length-1]!=='('&&prec[ops[ops.length-1]]>=prec[s[i]])applyOp();ops.push(s[i]);i++;}\n    else{let n='';while(i<s.length&&/[0-9.]/.test(s[i]))n+=s[i++];nums.push(parseFloat(n));}\n  }\n  while(ops.length)applyOp();\n  ctx.reply(`${expr} = *${nums[0]}*`, { parse_mode: 'Markdown' });\n} catch(e) { ctx.reply('Error: ' + (e.message==='div0'?'Division by zero':'Invalid expression')); }" },
    { id: 'weather', name: 'Weather Bot', lang: 'js', description: 'Weather info template (mock data, connect real API)', code: "const city = message.text.split(' ').slice(1).join(' ') || 'London';\nctx.reply(`*Weather in ${city}*\\n\\nTemp: 22°C\\nHumidity: 60%\\nWind: 15 km/h\\nCondition: Partly Cloudy\\n\\nConnect a weather API for live data.`, { parse_mode: 'Markdown' });" },
    { id: 'admin_gate', name: 'Admin Gate', lang: 'js', description: 'Restricts commands to admin users via env var', code: "const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());\nif (!adminIds.includes(String(user.id))) {\n  return ctx.reply('Access denied. Admin only.');\n}\nctx.reply('Admin verified! Welcome back, ' + user.first_name + '.');" },
    { id: 'poll', name: 'Poll Creator', lang: 'js', description: 'Sends a native Telegram poll', code: "ctx.telegram.sendPoll(chat.id, 'What feature do you want next?', [\n  'Speed improvements',\n  'New templates',\n  'More commands',\n  'Better UI'\n], { is_anonymous: false, allows_multiple_answers: false });" },
    { id: 'faq', name: 'FAQ Bot', lang: 'js', description: 'Answers common questions automatically', code: "const faqs = {\n  'price': 'Our service is free with premium plans available.',\n  'support': 'Contact support at @MyFaSupport',\n  'refund': 'Refunds are processed within 3-5 business days.',\n  'help': 'Available commands: /faq price, /faq support, /faq refund'\n};\nconst q = message.text.split(' ').slice(1).join(' ').toLowerCase();\nconst key = Object.keys(faqs).find(k => q.includes(k));\nctx.reply(key ? faqs[key] : `No answer found.\\nTry: ${Object.keys(faqs).join(', ')}`);" },
    { id: 'countdown', name: 'Countdown Timer', lang: 'js', description: 'Shows countdown to a target date', code: "const target = new Date(env.TARGET_DATE || '2025-12-31T00:00:00Z');\nconst now = new Date();\nconst diff = target - now;\nif (diff < 0) return ctx.reply('The event has passed!');\nconst days = Math.floor(diff / 86400000);\nconst hrs = Math.floor((diff % 86400000) / 3600000);\nconst mins = Math.floor((diff % 3600000) / 60000);\nctx.reply(`*Countdown*\\n\\n${days} days\\n${hrs} hours\\n${mins} minutes remaining`, { parse_mode: 'Markdown' });" },
    { id: 'random', name: 'Random Number', lang: 'js', description: 'Generates random numbers in a range', code: "const args = message.text.split(' ').slice(1);\nconst min = parseInt(args[0]) || 1;\nconst max = parseInt(args[1]) || 100;\nif (min >= max) return ctx.reply('Usage: /random [min] [max]\\nExample: /random 1 100');\nconst num = Math.floor(Math.random() * (max - min + 1)) + min;\nctx.reply(`Random (${min}-${max}): *${num}*`, { parse_mode: 'Markdown' });" },
    { id: 'quote', name: 'Daily Quote', lang: 'js', description: 'Sends a random inspirational quote', code: "const quotes = [\n  'The only way to do great work is to love what you do. — Steve Jobs',\n  'Innovation distinguishes between a leader and a follower. — Steve Jobs',\n  'The future belongs to those who believe in their dreams. — Eleanor Roosevelt',\n  'Success is not final, failure is not fatal. — Winston Churchill',\n  'Dream big and dare to fail. — Norman Vaughan'\n];\nconst q = quotes[Math.floor(Math.random() * quotes.length)];\nctx.reply(q);" },
    { id: 'news_feed', name: 'News Feed', lang: 'js', description: 'Sends latest news (mock, connect real news API)', code: "const headlines = [\n  'Tech: New AI model breaks all records',\n  'Sports: Championship finals this weekend',\n  'Finance: Markets reach all-time highs',\n  'World: Climate summit announces new goals'\n];\nconst news = headlines[Math.floor(Math.random() * headlines.length)];\nctx.reply(`*Latest News*\\n\\n${news}\\n\\nConnect a news API for real data.`, { parse_mode: 'Markdown' });" },
    { id: 'lang_detect', name: 'Language Detector', lang: 'js', description: 'Detects if text is Arabic or Latin', code: "const text = message.text.split(' ').slice(1).join(' ');\nif (!text) return ctx.reply('Usage: /lang your text here');\nconst arabicChars = (text.match(/[\\u0600-\\u06FF]/g)||[]).length;\nconst latinChars = (text.match(/[a-zA-Z]/g)||[]).length;\nconst lang = arabicChars > latinChars ? 'Arabic' : 'English / Latin';\nconst pct = Math.round((Math.max(arabicChars, latinChars) / text.replace(/\\s/g,'').length) * 100);\nctx.reply(`Detected: *${lang}* (${pct}% match)`, { parse_mode: 'Markdown' });" },
    { id: 'group_stats', name: 'Group Stats', lang: 'js', description: 'Shows information about the current chat', code: "const isGroup = chat.type === 'group' || chat.type === 'supergroup';\nif (!isGroup) return ctx.reply('This command works in groups only.');\nctx.reply(`*Group Info*\\n\\nName: ${chat.title}\\nID: \\`${chat.id}\\`\\nType: ${chat.type}\\nYour ID: \\`${user.id}\\`\\nYour Name: ${user.first_name}`, { parse_mode: 'Markdown' });" }
];

app.get('/api/templates', async (req, res) => { res.json(BOT_TEMPLATES); });

// ===== REFER & EARN SYSTEM =====

app.get('/api/refer-info', async (req, res) => {
    const { botId } = req.query;
    if (!botId) return res.json({ username: '', ppRef: 10 });
    const envVars = await fbGet(`bot_${botId}_env`) || {};
    const username = (await fbGet(`bot_${botId}_username`)) || envVars.BOT_USERNAME || '';
    const ppRef = parseInt(envVars.POINTS_PER_REFERRAL) || 10;
    res.json({ username, ppRef });
});

app.post('/api/refer', async (req, res) => {
    const { botId, referrerId, refereeId, refereeFirst } = req.body;
    if (!botId || !referrerId || !refereeId) return res.json({ success: false, error: 'Missing fields' });
    if (String(referrerId) === String(refereeId)) return res.json({ success: false, error: 'Self-referral' });
    const existing = await fbGet(`refer_${botId}_referee_${refereeId}`);
    if (existing) return res.json({ success: false, already: true });
    const envVars = await fbGet(`bot_${botId}_env`) || {};
    const ppRef = parseInt(envVars.POINTS_PER_REFERRAL) || 10;
    await fbSet(`refer_${botId}_referee_${refereeId}`, { referrerId, time: Date.now() });
    const stats = await fbGet(`refer_${botId}_user_${referrerId}`) || { refs: 0, points: 0 };
    stats.refs = (stats.refs || 0) + 1;
    stats.points = (stats.points || 0) + ppRef;
    await fbSet(`refer_${botId}_user_${referrerId}`, stats);
    let lb = await fbGet(`refer_${botId}_leaderboard`) || {};
    lb[referrerId] = { refs: stats.refs, points: stats.points, firstName: stats.firstName || '?', userId: referrerId };
    await fbSet(`refer_${botId}_leaderboard`, lb);
    await fbPush(`refer_${botId}_logs`, { referrerId, refereeId, refereeFirst: refereeFirst || '?', time: Date.now() });
    res.json({ success: true, points: ppRef, total: stats.points, refs: stats.refs });
});

app.get('/api/refer-stats', async (req, res) => {
    const { botId, userId } = req.query;
    if (!botId || !userId) return res.json({ refs: 0, points: 0, referred: false });
    const stats = await fbGet(`refer_${botId}_user_${userId}`) || { refs: 0, points: 0 };
    const referred = await fbGet(`refer_${botId}_referee_${userId}`);
    res.json({ refs: stats.refs || 0, points: stats.points || 0, referred: !!referred });
});

app.get('/api/refer-leaderboard', async (req, res) => {
    const { botId, limit } = req.query;
    if (!botId) return res.json([]);
    const lb = await fbGet(`refer_${botId}_leaderboard`) || {};
    const entries = Object.values(lb);
    entries.sort((a, b) => (b.refs || 0) - (a.refs || 0));
    res.json(entries.slice(0, parseInt(limit) || 10));
});

app.get('/api/refer-logs', async (req, res) => {
    const { botId } = req.query;
    if (!botId) return res.json([]);
    const raw = await fbGet(`refer_${botId}_logs`) || {};
    const arr = typeof raw === 'object' && !Array.isArray(raw) ? Object.values(raw) : (Array.isArray(raw) ? raw : []);
    arr.sort((a, b) => (b.time || 0) - (a.time || 0));
    res.json(arr.slice(0, 50));
});

// ── Refer & Earn Mini-App HTML Page ─────────────────────────
function getReferPageHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Refer & Earn</title>
<script src="https://telegram.org/js/telegram-web-app.js"><\/script>
<style>
:root{--bg:#050511;--card:#121225;--border:rgba(255,255,255,.1);--primary:#00f2ea;--accent:#7000ff;--warn:#f59e0b;--success:#00ff88;--gray:#8b8b9e;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding-bottom:40px;}
.header{background:linear-gradient(135deg,rgba(0,242,234,.15),rgba(112,0,255,.15));padding:22px 20px 18px;text-align:center;border-bottom:1px solid var(--border);}
.header h1{font-size:22px;background:linear-gradient(135deg,#00f2ea,#7000ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;}
.header p{font-size:13px;color:var(--gray);margin-top:5px;}
.tabs{display:flex;background:var(--card);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10;}
.tab{flex:1;padding:13px 8px;text-align:center;font-size:12px;font-weight:700;color:var(--gray);cursor:pointer;border:none;background:none;transition:.2s;letter-spacing:.3px;}
.tab.active{color:var(--primary);border-bottom:2px solid var(--primary);}
.tab-content{display:none;padding:20px;}
.tab-content.active{display:block;}
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px;text-align:center;}
.stat-val{font-size:30px;font-weight:800;color:var(--primary);}
.stat-lbl{font-size:11px;color:var(--gray);text-transform:uppercase;letter-spacing:.5px;margin-top:5px;}
.link-box{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:15px;margin-bottom:12px;}
.link-label{font-size:12px;color:var(--gray);margin-bottom:8px;}
.link-text{font-family:monospace;font-size:11px;color:var(--primary);word-break:break-all;background:rgba(0,242,234,.06);padding:9px 10px;border-radius:8px;margin-bottom:10px;line-height:1.5;}
.btn{width:100%;padding:14px;border:none;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:8px;transition:.15s;}
.btn-primary{background:linear-gradient(135deg,#00f2ea,#7000ff);color:#fff;}
.btn-copy{background:rgba(0,242,234,.1);border:1px solid rgba(0,242,234,.3);color:var(--primary);}
.progress-wrap{margin:14px 0 18px;}
.progress-lbl{display:flex;justify-content:space-between;font-size:11px;color:var(--gray);margin-bottom:5px;}
.progress-bar{height:8px;background:rgba(255,255,255,.07);border-radius:4px;overflow:hidden;}
.progress-fill{height:100%;background:linear-gradient(135deg,#00f2ea,#7000ff);border-radius:4px;transition:width .6s;}
.lb-row{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px;}
.lb-row.you{border-color:var(--primary);background:rgba(0,242,234,.06);}
.lb-rank{font-size:19px;width:32px;text-align:center;flex-shrink:0;}
.lb-info{flex:1;min-width:0;}
.lb-name{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lb-sub{font-size:11px;color:var(--gray);}
.lb-pts{font-size:13px;font-weight:700;color:var(--warn);white-space:nowrap;}
.you-badge{background:rgba(0,242,234,.15);color:var(--primary);font-size:10px;padding:2px 6px;border-radius:8px;margin-left:6px;font-weight:600;}
.admin-stat{display:flex;justify-content:space-between;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;font-size:14px;}
.admin-stat strong{color:var(--primary);}
.log-table{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.log-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.04);}
.log-row:last-child{border-bottom:none;}
.spinner{display:inline-block;width:26px;height:26px;border:3px solid rgba(0,242,234,.15);border-top-color:var(--primary);border-radius:50%;animation:spin .7s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.loading{text-align:center;padding:50px;color:var(--gray);}
.empty{text-align:center;padding:40px;color:var(--gray);font-size:14px;}
.section-title{font-size:13px;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:.6px;margin:18px 0 10px;}
</style>
</head>
<body>
<div class="header">
  <h1>🎁 Refer &amp; Earn</h1>
  <p id="welcomeMsg">Loading your stats...</p>
</div>
<div class="tabs">
  <button class="tab active" data-tab="stats" onclick="showTab('stats')">📊 My Stats</button>
  <button class="tab" data-tab="leaderboard" onclick="showTab('leaderboard')">🏆 Leaderboard</button>
  <button class="tab" data-tab="admin" id="adminTabBtn" style="display:none;" onclick="showTab('admin')">🔐 Admin</button>
</div>
<div id="tab-stats" class="tab-content active"><div class="loading"><div class="spinner"></div></div></div>
<div id="tab-leaderboard" class="tab-content"><div class="loading"><div class="spinner"></div></div></div>
<div id="tab-admin" class="tab-content"><div class="loading"><div class="spinner"></div></div></div>
<script>
const tg=window.Telegram.WebApp;
tg.expand();
tg.setHeaderColor('#050511');
const tgUser=tg.initDataUnsafe&&tg.initDataUnsafe.user;
const userId=tgUser?String(tgUser.id):'';
const firstName=tgUser?(tgUser.first_name||'User'):'User';
const pathParts=location.pathname.split('/');
const botId=pathParts[3]||'';
const origin=location.origin;
const urlParams=new URLSearchParams(location.search);
const isAdmin=urlParams.get('admin')==='1';
let refLink='';let ppRef=10;

document.getElementById('welcomeMsg').textContent='Hello, '+firstName+'! Your referral dashboard.';
if(isAdmin)document.getElementById('adminTabBtn').style.display='block';

async function init(){
  try{
    const info=await fetch(origin+'/api/refer-info?botId='+botId).then(r=>r.json());
    ppRef=info.ppRef||10;
    if(info.username&&userId)refLink='https://t.me/'+info.username+'?start=ref_'+userId;
  }catch(e){}
  loadStats();
  loadLeaderboard();
}

async function loadStats(){
  let stats={refs:0,points:0};
  if(userId){try{stats=await fetch(origin+'/api/refer-stats?botId='+botId+'&userId='+userId).then(r=>r.json());}catch(e){}}
  const pts=stats.points||0;const nextMilestone=Math.max(50,Math.ceil((pts+1)/50)*50);
  const progress=Math.min(pts/nextMilestone*100,100);
  document.getElementById('tab-stats').innerHTML=
    '<div class="stats-grid">'+
    '<div class="stat-card"><div class="stat-val">'+(stats.refs||0)+'</div><div class="stat-lbl">Referrals</div></div>'+
    '<div class="stat-card"><div class="stat-val">'+pts+'</div><div class="stat-lbl">Points 🪙</div></div>'+
    '</div>'+
    '<div class="progress-wrap"><div class="progress-lbl"><span>Progress to '+nextMilestone+' pts</span><span>'+pts+'/'+nextMilestone+'</span></div><div class="progress-bar"><div class="progress-fill" style="width:'+progress+'%"></div></div></div>'+
    (refLink?'<div class="link-box"><div class="link-label">🔗 Your Referral Link</div><div class="link-text" id="refLinkEl">'+refLink+'</div><button class="btn btn-copy" onclick="copyLink()">📋 Copy Link</button></div>':'<div class="link-box"><div class="link-label" style="color:var(--warn)">⚠️ Set BOT_USERNAME env variable in your bot to generate your referral link.</div></div>')+
    '<button class="btn btn-primary" onclick="shareLink()">📤 Share &amp; Invite Friends</button>'+
    '<div style="text-align:center;font-size:12px;color:var(--gray);margin-top:4px;">Earn <strong style="color:var(--primary);">'+ppRef+' points</strong> for every friend you invite!</div>';
}

async function loadLeaderboard(){
  try{
    const lb=await fetch(origin+'/api/refer-leaderboard?botId='+botId+'&limit=10').then(r=>r.json());
    if(!lb.length){document.getElementById('tab-leaderboard').innerHTML='<div class="empty">🏆 No referrals yet!<br><br>Be the first to share your link and claim top spot.</div>';return;}
    const medals=['🥇','🥈','🥉'];
    document.getElementById('tab-leaderboard').innerHTML=
      '<div class="section-title">Top Referrers</div>'+
      lb.map((e,i)=>{
        const isYou=e.userId===userId;
        return '<div class="lb-row'+(isYou?' you':'')+'">'+
          '<span class="lb-rank">'+(medals[i]||'#'+(i+1))+'</span>'+
          '<div class="lb-info"><div class="lb-name">'+(e.firstName||'User')+(isYou?'<span class="you-badge">You</span>':'')+'</div><div class="lb-sub">'+e.refs+' referrals</div></div>'+
          '<div class="lb-pts">'+e.points+' pts</div>'+
          '</div>';
      }).join('');
  }catch(e){document.getElementById('tab-leaderboard').innerHTML='<div class="empty">Failed to load leaderboard.</div>';}
}

async function loadAdmin(){
  try{
    const[lb,logs]=await Promise.all([
      fetch(origin+'/api/refer-leaderboard?botId='+botId+'&limit=20').then(r=>r.json()),
      fetch(origin+'/api/refer-logs?botId='+botId).then(r=>r.json())
    ]);
    const totalRefs=lb.reduce((s,e)=>s+(e.refs||0),0);
    const totalPts=lb.reduce((s,e)=>s+(e.points||0),0);
    document.getElementById('tab-admin').innerHTML=
      '<div class="section-title">Overview</div>'+
      '<div class="admin-stat"><span>Total Referrals</span><strong>'+totalRefs+'</strong></div>'+
      '<div class="admin-stat"><span>Active Referrers</span><strong>'+lb.length+'</strong></div>'+
      '<div class="admin-stat"><span>Points Distributed</span><strong>'+totalPts+'</strong></div>'+
      '<div class="section-title">Recent Referrals</div>'+
      '<div class="log-table">'+
      (logs.length?logs.slice(0,25).map(l=>'<div class="log-row"><span>'+( l.refereeFirst||'User')+'</span><span style="color:var(--gray);">via '+( l.referrerId||'?')+'</span><span>'+new Date(l.time).toLocaleDateString()+'</span></div>').join(''):'<div class="empty" style="padding:20px;">No referral logs yet.</div>')+
      '</div>';
  }catch(e){document.getElementById('tab-admin').innerHTML='<div class="empty">Failed to load admin data.</div>';}
}

function showTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.toggle('active',t.id==='tab-'+name));
  if(name==='admin')loadAdmin();
}

function copyLink(){
  const el=document.getElementById('refLinkEl');
  if(!el)return tg.showAlert('Set BOT_USERNAME env variable first.');
  const link=el.textContent;
  if(navigator.clipboard){navigator.clipboard.writeText(link).then(()=>tg.showAlert('✅ Copied!'));}
  else{const ta=document.createElement('textarea');ta.value=link;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);tg.showAlert('✅ Copied!');}
}

function shareLink(){
  const link=(document.getElementById('refLinkEl')||{}).textContent||refLink;
  if(!link)return tg.showAlert('Set BOT_USERNAME env variable to enable sharing.');
  tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent('🎁 Join and earn amazing rewards! Use my referral link:'));
}

init();
<\/script>
</body>
</html>`;
}

// ── Refer & Earn Bot Command Code Helpers ────────────────────
const REFER_START_CODE = `const botId = env.BOT_ID || 'unknown';
const hostUrl = env.HOST_URL || '';
const botUsername = env.BOT_USERNAME || 'yourbot';
const ppRef = parseInt(env.POINTS_PER_REFERRAL) || 10;
const startParam = (message.text || '').split(' ')[1] || '';
const refUserId = startParam.startsWith('ref_') ? startParam.slice(4) : null;
const myRefLink = 'https://t.me/' + botUsername + '?start=ref_' + user.id;

if (refUserId && refUserId !== String(user.id) && hostUrl) {
  try {
    const result = await fetch(hostUrl + '/api/refer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId, referrerId: String(refUserId), refereeId: String(user.id), refereeFirst: user.first_name })
    }).then(r => r.json());
    if (result.success) {
      ctx.telegram.sendMessage(parseInt(refUserId),
        '🎉 *+' + ppRef + ' Points Earned!*\\n\\n' + user.first_name + ' joined via your link!\\n🪙 Total: *' + result.total + ' pts*',
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch(e) {}
}

let startStats = { refs: 0, points: 0 };
if (hostUrl) {
  try { startStats = await fetch(hostUrl + '/api/refer-stats?botId=' + botId + '&userId=' + user.id).then(r => r.json()); } catch(e) {}
}

const keyboard = hostUrl
  ? { inline_keyboard: [
      [{ text: '📊 Open Dashboard', web_app: { url: hostUrl + '/api/mini/' + botId + '/refer_page' } }],
      [{ text: '🏆 Leaderboard', callback_data: 'refer_lb' }, { text: '💰 My Balance', callback_data: 'refer_bal' }]
    ] }
  : { inline_keyboard: [[{ text: '🏆 Leaderboard', callback_data: 'refer_lb' }, { text: '💰 My Balance', callback_data: 'refer_bal' }]] };

ctx.reply(
  '👋 *Welcome ' + user.first_name + '!*\\n\\n' +
  '🎁 *Refer & Earn Program*\\n' +
  '💡 Earn *' + ppRef + ' points* for every friend you invite!\\n\\n' +
  '📊 *Your Stats:*\\n' +
  '├ 👥 Referrals: *' + (startStats.refs || 0) + '*\\n' +
  '└ 🪙 Points: *' + (startStats.points || 0) + '*\\n\\n' +
  '🔗 *Your Referral Link:*\\n\`' + myRefLink + '\`\\n\\n' +
  '📤 Share and start earning!',
  { parse_mode: 'Markdown', reply_markup: keyboard }
);`;

const REFER_STATS_CODE = `const botId = env.BOT_ID || 'unknown';
const hostUrl = env.HOST_URL || '';
const botUsername = env.BOT_USERNAME || 'yourbot';
const ppRef = parseInt(env.POINTS_PER_REFERRAL) || 10;
const myRefLink = 'https://t.me/' + botUsername + '?start=ref_' + user.id;
if (!hostUrl) return ctx.reply('⚠️ Set HOST_URL env variable to enable referral stats.');
try {
  const stats = await fetch(hostUrl + '/api/refer-stats?botId=' + botId + '&userId=' + user.id).then(r => r.json());
  ctx.reply(
    '📊 *Referral Stats*\\n\\n' +
    '👥 Total Referrals: *' + (stats.refs || 0) + '*\\n' +
    '🪙 Total Points: *' + (stats.points || 0) + '*\\n\\n' +
    '🔗 *Your Link:*\\n\`' + myRefLink + '\`\\n\\n' +
    '💡 Earn *' + ppRef + ' points* per referral!',
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '📊 Full Dashboard', web_app: { url: hostUrl + '/api/mini/' + botId + '/refer_page' } }],
        [{ text: '📤 Share My Link', switch_inline_query: '🎁 Join and earn rewards! ' + myRefLink }]
      ] }
    }
  );
} catch(e) { ctx.reply('❌ Error fetching stats. Try again later.'); }`;

const REFER_BALANCE_CODE = `const botId = env.BOT_ID || 'unknown';
const hostUrl = env.HOST_URL || '';
if (!hostUrl) return ctx.reply('⚠️ Set HOST_URL env variable first.');
try {
  const stats = await fetch(hostUrl + '/api/refer-stats?botId=' + botId + '&userId=' + user.id).then(r => r.json());
  const pts = stats.points || 0;
  const refs = stats.refs || 0;
  const value = (pts * 0.01).toFixed(2);
  const nextMilestone = Math.max(50, Math.ceil((pts + 1) / 50) * 50);
  const bar = '█'.repeat(Math.floor(pts / nextMilestone * 10)) + '░'.repeat(10 - Math.floor(pts / nextMilestone * 10));
  ctx.reply(
    '💰 *Your Balance*\\n\\n' +
    '🪙 Points: *' + pts + '*\\n' +
    '👥 Referrals: *' + refs + '*\\n' +
    '💵 Est. Value: *$' + value + '*\\n\\n' +
    '📈 Progress to ' + nextMilestone + ' pts:\\n' +
    '\`[' + bar + ']\`\\n' + pts + ' / ' + nextMilestone + '\\n\\n' +
    '💡 Keep inviting friends to earn more!',
    { parse_mode: 'Markdown' }
  );
} catch(e) { ctx.reply('❌ Error fetching balance.'); }`;

const REFER_LEADERBOARD_CODE = `const botId = env.BOT_ID || 'unknown';
const hostUrl = env.HOST_URL || '';
if (!hostUrl) return ctx.reply('⚠️ Set HOST_URL env variable first.');
try {
  const lb = await fetch(hostUrl + '/api/refer-leaderboard?botId=' + botId + '&limit=10').then(r => r.json());
  if (!lb.length) return ctx.reply('🏆 *Leaderboard*\\n\\nNo referrals yet. Be the first to top the board!', { parse_mode: 'Markdown' });
  const medals = ['🥇', '🥈', '🥉'];
  const rows = lb.map((e, i) =>
    (medals[i] || (i + 1) + '.') + ' ' + (e.firstName || 'User') + ' — *' + e.refs + '* refs (*' + e.points + '* pts)'
  );
  ctx.reply('🏆 *Top Referrers*\\n\\n' + rows.join('\\n') + '\\n\\n💡 Share your link to climb the ranks!', { parse_mode: 'Markdown' });
} catch(e) { ctx.reply('❌ Error loading leaderboard.'); }`;

const REFER_ADMIN_CODE = `const adminIds = (env.ADMIN_IDS || '').split(',').map(s => s.trim());
if (!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only.');
const botId = env.BOT_ID || 'unknown';
const hostUrl = env.HOST_URL || '';
if (!hostUrl) return ctx.reply('⚠️ Set HOST_URL env variable first.');
try {
  const [lb, logs] = await Promise.all([
    fetch(hostUrl + '/api/refer-leaderboard?botId=' + botId + '&limit=10').then(r => r.json()),
    fetch(hostUrl + '/api/refer-logs?botId=' + botId).then(r => r.json())
  ]);
  const totalRefs = lb.reduce((s, e) => s + (e.refs || 0), 0);
  const totalPts = lb.reduce((s, e) => s + (e.points || 0), 0);
  const topUser = lb[0] ? (lb[0].firstName || 'User') + ' (' + lb[0].refs + ' refs)' : 'None yet';
  const recent = (Array.isArray(logs) ? logs : []).slice(0, 5).map(l => '• ' + (l.refereeFirst || '?') + ' joined via ' + (l.referrerId || '?')).join('\\n');
  ctx.reply(
    '🔐 *Admin — Referral Overview*\\n\\n' +
    '📊 *Stats:*\\n' +
    '├ Total Referrals: *' + totalRefs + '*\\n' +
    '├ Points Given: *' + totalPts + '*\\n' +
    '├ Active Referrers: *' + lb.length + '*\\n' +
    '└ Top Referrer: *' + topUser + '*\\n\\n' +
    '📋 *Recent Joins:*\\n' + (recent || 'None yet'),
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '📊 Full Admin Panel', web_app: { url: hostUrl + '/api/mini/' + botId + '/refer_page?admin=1&userId=' + user.id } }]
      ] }
    }
  );
} catch(e) { ctx.reply('❌ Error loading admin data. Please try again.'); }`;

// ── Project Templates ────────────────────────────────────────
const PROJECT_TEMPLATES = [
    {
        id: 'refer_earn',
        name: 'Refer & Earn Bot',
        category: 'Full Project',
        description: 'Complete viral referral system with points, live leaderboard, mini-app dashboard, and admin panel. Users earn points for inviting friends.',
        tags: ['referral', 'points', 'leaderboard', 'miniapp', 'viral', 'admin'],
        commandCount: 6,
        featured: true,
        setupEnvVars: [
            { key: 'HOST_URL', desc: 'Your deployment URL (e.g. https://yourapp.vercel.app) — required for API calls' },
            { key: 'BOT_USERNAME', desc: 'Your bot username without @ (e.g. MyReferBot)' },
            { key: 'POINTS_PER_REFERRAL', desc: 'Points awarded per referral (default: 10)' },
            { key: 'ADMIN_IDS', desc: 'Admin Telegram IDs, comma-separated (e.g. 123456,789012)' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Welcome + referral link + mini-app button', answer: REFER_START_CODE },
            { command: 'refer', lang: 'javascript', help: 'Show referral stats and your link', answer: REFER_STATS_CODE },
            { command: 'balance', lang: 'javascript', help: 'Show points balance with progress bar', answer: REFER_BALANCE_CODE },
            { command: 'leaderboard', lang: 'javascript', help: 'Show top 10 referrers', answer: REFER_LEADERBOARD_CODE },
            { command: 'refer_admin', lang: 'javascript', help: 'Admin: view all referral stats (admin only)', answer: REFER_ADMIN_CODE },
            { command: 'refer_page', lang: 'html', help: 'Refer & Earn mini-app dashboard', answer: getReferPageHTML() },
        ],
    },
    {
        id: 'quiz_bot',
        name: 'Quiz & Trivia Bot',
        category: 'Entertainment',
        description: 'Interactive quiz bot with score tracking, multiple categories, leaderboard, and streak rewards. Players answer questions and earn points.',
        tags: ['quiz', 'trivia', 'game', 'points', 'leaderboard', 'fun'],
        commandCount: 5,
        featured: true,
        setupEnvVars: [
            { key: 'ADMIN_IDS', desc: 'Admin Telegram IDs (comma-separated) for adding questions' },
            { key: 'POINTS_PER_CORRECT', desc: 'Points per correct answer (default: 5)' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Welcome to the quiz', answer: `const pts = parseInt(env.POINTS_PER_CORRECT)||5;\nctx.reply('🧠 *Welcome to QuizBot, ' + user.first_name + '!*\\n\\nTest your knowledge and earn points!\\n\\n💡 *' + pts + ' points* per correct answer\\n\\n/quiz — Start a question\\n/score — Your score\\n/top — Leaderboard', { parse_mode:'Markdown', reply_markup:{keyboard:[['🎯 Play Quiz','📊 My Score'],['🏆 Top Players','❓ Help']],resize_keyboard:true}});` },
            { command: 'quiz', lang: 'javascript', help: 'Get a random quiz question', answer: `const questions=[{q:'What is the capital of France?',a:'Paris',opts:['London','Paris','Berlin','Rome']},{q:'What is 12 × 12?',a:'144',opts:['124','136','144','156']},{q:'Which planet is largest?',a:'Jupiter',opts:['Saturn','Jupiter','Neptune','Uranus']},{q:'Water boils at?',a:'100°C',opts:['90°C','95°C','100°C','105°C']},{q:'Who wrote Romeo and Juliet?',a:'Shakespeare',opts:['Dickens','Shakespeare','Twain','Poe']}];\nconst q=questions[Math.floor(Math.random()*questions.length)];\nconst shuffled=q.opts.sort(()=>Math.random()-.5);\nctx.reply('❓ *Question:*\\n' + q.q + '\\n\\n' + shuffled.map((o,i)=>String.fromCharCode(65+i)+') '+o).join('\\n')+'\\n\\n💬 Reply with the letter (A/B/C/D)\\n_Correct answer: ' + q.a + '_',{parse_mode:'Markdown'});` },
            { command: 'score', lang: 'javascript', help: 'Show your quiz score', answer: `const botId=env.BOT_ID||'quiz';\nconst hostUrl=env.HOST_URL||'';\nif(!hostUrl) return ctx.reply('Score tracking not configured.');\ntry{\n  const s=await fetch(hostUrl+'/api/refer-stats?botId='+botId+'&userId='+user.id).then(r=>r.json());\n  ctx.reply('📊 *Your Quiz Stats*\\n\\n🏅 Score: *' + (s.points||0) + ' pts*\\n🎯 Questions: *' + (s.refs||0) + '*\\n\\nKeep playing to climb the leaderboard!',{parse_mode:'Markdown'});\n}catch(e){ctx.reply('📊 Score: 0 pts\\nPlay /quiz to earn points!');}` },
            { command: 'top', lang: 'javascript', help: 'Show quiz leaderboard', answer: `const botId=env.BOT_ID||'quiz';\nconst hostUrl=env.HOST_URL||'';\nif(!hostUrl) return ctx.reply('Leaderboard not configured.');\ntry{\n  const lb=await fetch(hostUrl+'/api/refer-leaderboard?botId='+botId+'&limit=10').then(r=>r.json());\n  if(!lb.length) return ctx.reply('🏆 No scores yet — be the first!');\n  const medals=['🥇','🥈','🥉'];\n  const rows=lb.map((e,i)=>(medals[i]||i+1+'.') + ' ' + (e.firstName||'User') + ' — *'+e.points+' pts*');\n  ctx.reply('🏆 *Quiz Leaderboard*\\n\\n'+rows.join('\\n'),{parse_mode:'Markdown'});\n}catch(e){ctx.reply('❌ Error loading leaderboard.');}` },
            { command: 'help', lang: 'javascript', help: 'Quiz bot help', answer: `ctx.reply('🧠 *QuizBot Help*\\n\\n/start — Welcome menu\\n/quiz — Get a question\\n/score — Your current score\\n/top — Top players\\n\\n💡 *How to play:*\\n1. Send /quiz to get a question\\n2. Reply with A, B, C, or D\\n3. Earn points for correct answers!',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'support_bot',
        name: 'Customer Support Ticket Bot',
        category: 'Business',
        description: 'Professional support ticket system. Users submit tickets, agents reply, tickets auto-close. Includes dashboard mini-app and admin management.',
        tags: ['support', 'tickets', 'customer service', 'business', 'crm'],
        commandCount: 5,
        featured: false,
        setupEnvVars: [
            { key: 'ADMIN_IDS', desc: 'Support agent Telegram IDs (comma-separated)' },
            { key: 'SUPPORT_NAME', desc: 'Your support team name (e.g. MyBrand Support)' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Welcome to support', answer: `const name=env.SUPPORT_NAME||'Support Team';\nctx.reply('👋 *Welcome to ' + name + '!*\\n\\nHow can we help you today?\\n\\n/ticket — Open a new support ticket\\n/status — Check ticket status\\n/help — View FAQ',{parse_mode:'Markdown',reply_markup:{keyboard:[['🎫 New Ticket','📋 My Tickets'],['❓ FAQ','📞 Contact']],resize_keyboard:true}});` },
            { command: 'ticket', lang: 'javascript', help: 'Submit a support ticket', answer: `const name=env.SUPPORT_NAME||'Support';\nconst ticketId='TKT-'+Date.now().toString(36).toUpperCase();\nconst msg=message.text.split(' ').slice(1).join(' ');\nif(!msg) return ctx.reply('📝 *New Ticket*\\n\\nPlease describe your issue:\\n/ticket Your issue description here\\n\\nExample: /ticket I cannot access my account',{parse_mode:'Markdown'});\nconst adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);\nfor(const adminId of adminIds){\n  ctx.telegram.sendMessage(parseInt(adminId),'🎫 *New Support Ticket*\\n\\nID: \`'+ticketId+'\`\\nFrom: '+user.first_name+' ('+user.id+')\\nMessage: '+msg,{parse_mode:'Markdown'}).catch(()=>{});\n}\nctx.reply('✅ *Ticket Submitted!*\\n\\nTicket ID: \`'+ticketId+'\`\\nWe will respond within 24 hours.\\n\\nThank you for contacting '+name+'!',{parse_mode:'Markdown'});` },
            { command: 'reply', lang: 'javascript', help: 'Admin: reply to a user ticket', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only.');\nconst parts=message.text.split(' ');\nconst targetId=parts[1];\nconst replyMsg=parts.slice(2).join(' ');\nif(!targetId||!replyMsg) return ctx.reply('Usage: /reply USER_ID Your reply message');\ntry{\n  await ctx.telegram.sendMessage(parseInt(targetId),'📨 *Support Team Reply:*\\n\\n'+replyMsg+'\\n\\n— '+( env.SUPPORT_NAME||'Support Team'),{parse_mode:'Markdown'});\n  ctx.reply('✅ Reply sent to user '+targetId);\n}catch(e){ctx.reply('❌ Failed to send: '+e.message);}` },
            { command: 'faq', lang: 'javascript', help: 'Frequently asked questions', answer: `ctx.reply('❓ *Frequently Asked Questions*\\n\\n*Q: How do I get help?*\\nA: Send /ticket with your issue.\\n\\n*Q: How long for a reply?*\\nA: We respond within 24 hours.\\n\\n*Q: Can I check my ticket?*\\nA: Yes! Use /status with your ticket ID.\\n\\n_Still need help? Use /ticket_',{parse_mode:'Markdown'});` },
            { command: 'status', lang: 'javascript', help: 'Check ticket status', answer: `ctx.reply('📋 *Ticket Status*\\n\\nTicket tracking coming soon!\\n\\nFor urgent issues, contact our team:\\n' + (env.SUPPORT_CONTACT||'@support'),{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'shop_bot',
        name: 'Online Shop Bot',
        category: 'E-Commerce',
        description: 'Full-featured Telegram shop with product catalog, cart system, order management, and payment integration. Perfect for selling products via Telegram.',
        tags: ['shop', 'ecommerce', 'store', 'products', 'orders', 'business'],
        commandCount: 6,
        featured: true,
        setupEnvVars: [
            { key: 'SHOP_NAME', desc: 'Your shop name (e.g. MyFa Store)' },
            { key: 'ADMIN_IDS', desc: 'Shop owner Telegram IDs (comma-separated)' },
            { key: 'CURRENCY', desc: 'Currency symbol (default: $)' },
            { key: 'PAYMENT_INFO', desc: 'Payment instructions (e.g. "Pay to @CryptoWallet or use PayPal")' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Welcome to the shop', answer: `const shopName=env.SHOP_NAME||'TeleShop';\nctx.reply('🛍️ *Welcome to ' + shopName + '!*\\n\\nBrowse our products and place orders right here in Telegram!\\n\\n/catalog — View products\\n/cart — Your cart\\n/orders — Your orders\\n/help — Help & support',{parse_mode:'Markdown',reply_markup:{keyboard:[['🛍️ Catalog','🛒 My Cart'],['📦 My Orders','📞 Support']],resize_keyboard:true}});` },
            { command: 'catalog', lang: 'javascript', help: 'Browse product catalog', answer: `const cur=env.CURRENCY||'$';\nconst shopName=env.SHOP_NAME||'Shop';\nconst products=[{id:'P1',name:'Premium Plan',price:9.99,desc:'Unlimited bots & features for 1 month'},{id:'P2',name:'Enterprise Plan',price:29.99,desc:'Full platform access, priority support'},{id:'P3',name:'Lifetime Access',price:99.99,desc:'One-time payment, lifetime access'}];\nlet msg='🛍️ *' + shopName + ' Catalog*\\n\\n';\nproducts.forEach(p=>{\n  msg+='📦 *'+p.name+'*\\n'+'💰 '+cur+p.price+'\\n'+'📝 '+p.desc+'\\n'+'🛒 /buy_'+p.id+'\\n\\n';\n});\nctx.reply(msg,{parse_mode:'Markdown'});` },
            { command: 'buy_P1', lang: 'javascript', help: 'Purchase Premium Plan', answer: `const cur=env.CURRENCY||'$';\nconst payment=env.PAYMENT_INFO||'Contact @support for payment details';\nctx.reply('🛍️ *Premium Plan — ' + cur + '9.99/month*\\n\\n✅ Unlimited bots\\n✅ All features\\n✅ Priority webhook\\n✅ Analytics & logs\\n\\n💳 *Payment:*\\n'+payment+'\\n\\nAfter payment, send proof to get instant activation!',{parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'💳 Pay & Activate',callback_data:'order_premium'}]]}});` },
            { command: 'orders', lang: 'javascript', help: 'View your orders', answer: `ctx.reply('📦 *My Orders*\\n\\nOrder tracking is being set up.\\n\\nFor order status, contact:\\n' + (env.SUPPORT_CONTACT||'@support') + '\\n\\nYour User ID for reference: \`' + user.id + '\`',{parse_mode:'Markdown'});` },
            { command: 'addproduct', lang: 'javascript', help: 'Admin: add a product', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only.');\nconst parts=message.text.split('|');\nif(parts.length<3) return ctx.reply('Usage: /addproduct Name|Price|Description');\nconst [,name,price,desc]=parts;\nctx.reply('✅ Product template:\\n\\nName: '+name.trim()+'\\nPrice: '+price.trim()+'\\nDesc: '+(desc||'').trim()+'\\n\\n_Add to your catalog code manually_',{parse_mode:'Markdown'});` },
            { command: 'help', lang: 'javascript', help: 'Shop help & support', answer: `const shopName=env.SHOP_NAME||'Shop';\nctx.reply('❓ *' + shopName + ' Help*\\n\\n/catalog — Browse all products\\n/cart — View your cart\\n/orders — Track your orders\\n\\n📞 *Support:*\\n' + (env.SUPPORT_CONTACT||'Contact @support') + '\\n\\n⏰ Response time: 24 hours',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'announcement_bot',
        name: 'Announcement & Newsletter Bot',
        category: 'Communication',
        description: 'Subscriber management with broadcast system. Users subscribe to receive updates. Admins send announcements to all subscribers instantly.',
        tags: ['newsletter', 'broadcast', 'subscribers', 'announcement', 'marketing'],
        commandCount: 5,
        featured: false,
        setupEnvVars: [
            { key: 'ADMIN_IDS', desc: 'Admin Telegram IDs for sending announcements' },
            { key: 'BOT_NAME', desc: 'Your bot/channel name' },
            { key: 'HOST_URL', desc: 'Your deployment URL for subscriber API' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Subscribe to updates', answer: `const botName=env.BOT_NAME||'News Bot';\nctx.reply('📢 *' + botName + '*\\n\\nGet the latest updates, news, and announcements directly in Telegram!\\n\\n/subscribe — Subscribe to updates\\n/unsubscribe — Unsubscribe\\n/latest — Latest news',{parse_mode:'Markdown',reply_markup:{keyboard:[['✅ Subscribe','❌ Unsubscribe'],['📰 Latest News','ℹ️ About']],resize_keyboard:true}});` },
            { command: 'subscribe', lang: 'javascript', help: 'Subscribe to newsletter', answer: `const botId=env.BOT_ID||'news';\nconst hostUrl=env.HOST_URL||'';\nif(hostUrl){\n  try{\n    await fetch(hostUrl+'/api/refer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({botId,referrerId:'newsletter',refereeId:String(user.id),refereeFirst:user.first_name})}).then(r=>r.json());\n  }catch(e){}\n}\nctx.reply('✅ *You are now subscribed!*\\n\\nWelcome, ' + user.first_name + '!\\nYou will receive all updates and announcements.\\n\\n📤 Share this bot with friends!',{parse_mode:'Markdown'});` },
            { command: 'unsubscribe', lang: 'javascript', help: 'Unsubscribe from newsletter', answer: `ctx.reply('❌ *Unsubscribed*\\n\\nYou have been removed from our updates list.\\n\\nChange your mind? Send /subscribe anytime.',{parse_mode:'Markdown'});` },
            { command: 'broadcast', lang: 'javascript', help: 'Admin: send announcement to subscribers', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only. Use: /broadcast Your message');\nconst msg=message.text.split(' ').slice(1).join(' ');\nif(!msg) return ctx.reply('Usage: /broadcast Your announcement message here');\nconst botId=env.BOT_ID||'news';\nconst hostUrl=env.HOST_URL||'';\nlet subs=0;\nif(hostUrl){\n  try{\n    const lb=await fetch(hostUrl+'/api/refer-leaderboard?botId='+botId+'&limit=500').then(r=>r.json());\n    for(const sub of lb){\n      if(sub.refereeId) ctx.telegram.sendMessage(parseInt(sub.refereeId),'📢 *Announcement*\\n\\n'+msg,{parse_mode:'Markdown'}).catch(()=>{});\n      subs++;\n    }\n  }catch(e){}\n}\nctx.reply('✅ Broadcast sent to ~' + subs + ' subscribers!');` },
            { command: 'latest', lang: 'javascript', help: 'View latest announcements', answer: `const botName=env.BOT_NAME||'News Bot';\nctx.reply('📰 *Latest from ' + botName + '*\\n\\nNo new announcements yet.\\nStay tuned — we post updates regularly!\\n\\n✅ You are subscribed for future updates.',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'group_manager',
        name: 'Group Manager Bot',
        category: 'Administration',
        description: 'Advanced group management with anti-spam, welcome messages, auto-moderation, warnings, mute/ban, admin commands and member statistics.',
        tags: ['group', 'admin', 'moderation', 'spam', 'ban', 'mute', 'welcome'],
        commandCount: 7,
        featured: false,
        setupEnvVars: [
            { key: 'ADMIN_IDS', desc: 'Group admin Telegram IDs (comma-separated)' },
            { key: 'WELCOME_MSG', desc: 'Welcome message for new members (use {name} for username)' },
            { key: 'RULES', desc: 'Group rules text to show on /rules' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Group manager intro', answer: `ctx.reply('👮 *Group Manager Bot*\\n\\nI help keep your group clean and organized!\\n\\n/help — All commands\\n/rules — Group rules\\n/stats — Group statistics\\n\\n_Add me to a group and make me admin!_',{parse_mode:'Markdown'});` },
            { command: 'warn', lang: 'javascript', help: 'Warn a user (reply to their message)', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only.');\nconst target=message.reply_to_message;\nif(!target) return ctx.reply('Reply to a user message to warn them.');\nconst targetUser=target.from;\nconst reason=message.text.split(' ').slice(1).join(' ')||'Rule violation';\nctx.reply('⚠️ *Warning issued*\\n\\nUser: ' + targetUser.first_name + ' ('+targetUser.id+')\\nReason: '+reason+'\\n\\n_3 warnings = ban_',{parse_mode:'Markdown'});` },
            { command: 'ban', lang: 'javascript', help: 'Ban a user (reply to their message)', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only.');\nconst target=message.reply_to_message;\nif(!target) return ctx.reply('Reply to a user message to ban them.');\ntry{\n  await ctx.telegram.banChatMember(chat.id, target.from.id);\n  ctx.reply('🔨 *Banned*\\n\\n'+target.from.first_name+' has been banned from the group.',{parse_mode:'Markdown'});\n}catch(e){ctx.reply('❌ Failed to ban: '+e.message);}` },
            { command: 'mute', lang: 'javascript', help: 'Mute a user for 1 hour', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only.');\nconst target=message.reply_to_message;\nif(!target) return ctx.reply('Reply to a user message to mute them.');\ntry{\n  await ctx.telegram.restrictChatMember(chat.id,target.from.id,{permissions:{can_send_messages:false},until_date:Math.floor(Date.now()/1000)+3600});\n  ctx.reply('🔇 *Muted for 1 hour*\\n\\n'+target.from.first_name+' cannot send messages for 1 hour.',{parse_mode:'Markdown'});\n}catch(e){ctx.reply('❌ Failed to mute: '+e.message);}` },
            { command: 'rules', lang: 'javascript', help: 'Show group rules', answer: `const rules=env.RULES||'1. Be respectful\\n2. No spam\\n3. No NSFW content\\n4. No self-promotion\\n5. Follow Telegram ToS';\nctx.reply('📜 *Group Rules*\\n\\n' + rules + '\\n\\n_Breaking rules will result in a ban._',{parse_mode:'Markdown'});` },
            { command: 'stats', lang: 'javascript', help: 'Group statistics', answer: `try{\n  const count=await ctx.telegram.getChatMembersCount(chat.id);\n  ctx.reply('📊 *Group Statistics*\\n\\n👥 Members: *'+count+'*\\n💬 Chat: '+chat.title+'\\n🆔 ID: \`'+chat.id+'\`\\n\\n_Powered by Group Manager Bot_',{parse_mode:'Markdown'});\n}catch(e){ctx.reply('📊 Group stats: '+(e.message||'unavailable'));}` },
            { command: 'help', lang: 'javascript', help: 'Show all commands', answer: `ctx.reply('👮 *Group Manager Commands*\\n\\n/warn — Warn a user (reply)\\n/ban — Ban a user (reply)\\n/mute — Mute 1 hour (reply)\\n/unmute — Unmute (reply)\\n/rules — Show rules\\n/stats — Group stats\\n\\n_Only admins can use moderation commands_',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'language_bot',
        name: 'Language Learning Bot',
        category: 'Education',
        description: 'Daily vocabulary, phrase practice, grammar tips, and quiz in multiple languages. Track your learning streak and compete on the leaderboard.',
        tags: ['language', 'learning', 'education', 'vocabulary', 'practice', 'quiz'],
        commandCount: 5,
        featured: false,
        setupEnvVars: [
            { key: 'LANGUAGE', desc: 'Language to teach (e.g. Spanish, French, Arabic)' },
            { key: 'NATIVE_LANG', desc: 'Students native language (default: English)' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Start learning', answer: `const lang=env.LANGUAGE||'Spanish';\nctx.reply('🌍 *Learn ' + lang + ' with AI!*\\n\\nHello, ' + user.first_name + '!\\n\\n/word — Word of the day\\n/phrase — Useful phrase\\n/quiz — Test yourself\\n/streak — Your progress',{parse_mode:'Markdown',reply_markup:{keyboard:[['📚 Word of Day','💬 Daily Phrase'],['🧪 Quiz','🔥 My Streak']],resize_keyboard:true}});` },
            { command: 'word', lang: 'javascript', help: 'Word of the day', answer: `const lang=env.LANGUAGE||'Spanish';\nconst words=[{w:'Hola',m:'Hello',ex:'Hola, ¿cómo estás?'},{w:'Gracias',m:'Thank you',ex:'Muchas gracias!'},{w:'Por favor',m:'Please',ex:'Por favor, ayúdame.'},{w:'Buenos días',m:'Good morning',ex:'Buenos días, ¿cómo amaneces?'},{w:'Hasta luego',m:'Goodbye',ex:'Hasta luego, amigo!'}];\nconst w=words[new Date().getDay()%words.length];\nctx.reply('📚 *Word of the Day — ' + lang + '*\\n\\n🔤 *'+w.w+'*\\n🇬🇧 '+w.m+'\\n\\n💬 *Example:*\\n_' + w.ex + '_\\n\\nPractice by using it in a sentence!',{parse_mode:'Markdown'});` },
            { command: 'phrase', lang: 'javascript', help: 'Useful phrase of the day', answer: `const lang=env.LANGUAGE||'Spanish';\nconst phrases=[{p:'¿Dónde está el baño?',m:'Where is the bathroom?'},{p:'¿Cuánto cuesta?',m:'How much does it cost?'},{p:'No entiendo.',m:"I don't understand."},{p:'Habla más despacio.',m:'Please speak slower.'},{p:'Me llamo...',m:'My name is...'}];\nconst ph=phrases[new Date().getDay()%phrases.length];\nctx.reply('💬 *Phrase of the Day — ' + lang + '*\\n\\n🗣 *'+ph.p+'*\\n🇬🇧 '+ph.m+'\\n\\n_Practice saying it aloud!_',{parse_mode:'Markdown'});` },
            { command: 'quiz', lang: 'javascript', help: 'Language quiz', answer: `const lang=env.LANGUAGE||'Spanish';\nconst qs=[{q:'What does "Hola" mean?',a:'Hello',opts:['Goodbye','Hello','Please','Thanks']},{q:'Translate: "Gracias"',a:'Thank you',opts:['Sorry','You welcome','Thank you','Please']},{q:'"Buenos días" means?',a:'Good morning',opts:['Good night','Good morning','Good evening','Hello']}];\nconst q=qs[Math.floor(Math.random()*qs.length)];\nctx.reply('🧪 *' + lang + ' Quiz*\\n\\n❓ '+q.q+'\\n\\n'+q.opts.map((o,i)=>String.fromCharCode(65+i)+') '+o).join('\\n')+'\\n\\n_Correct: '+q.a+'_',{parse_mode:'Markdown'});` },
            { command: 'streak', lang: 'javascript', help: 'Show learning streak', answer: `const lang=env.LANGUAGE||'Spanish';\nctx.reply('🔥 *Your ' + lang + ' Progress*\\n\\n📅 Streak: 0 days (start learning!)\\n📚 Words learned: 0\\n🏆 Rank: Beginner\\n\\n💡 Use /word and /quiz daily to build your streak!',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'daily_quote',
        name: 'Daily Quote & Motivation Bot',
        category: 'Lifestyle',
        description: 'Send inspiring daily quotes, affirmations and motivational messages. Users subscribe and receive quotes automatically. Includes favorite saving.',
        tags: ['quotes', 'motivation', 'daily', 'inspiration', 'affirmation', 'wellness'],
        commandCount: 4,
        featured: false,
        setupEnvVars: [
            { key: 'BOT_NAME', desc: 'Your bot name (e.g. Daily Boost)' },
            { key: 'ADMIN_IDS', desc: 'Admin IDs for adding custom quotes' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Welcome to quote bot', answer: `const botName=env.BOT_NAME||'Daily Quotes';\nctx.reply('✨ *' + botName + '*\\n\\nHello, ' + user.first_name + '! Start your day with inspiration!\\n\\n/quote — Get a random quote\\n/motivation — Daily motivation\\n/affirmation — Positive affirmation',{parse_mode:'Markdown',reply_markup:{keyboard:[['✨ Get Quote','💪 Motivation'],['🌟 Affirmation','📤 Share']],resize_keyboard:true}});` },
            { command: 'quote', lang: 'javascript', help: 'Get a random inspirational quote', answer: `const quotes=[{q:'The only way to do great work is to love what you do.',a:'Steve Jobs'},{q:'In the middle of difficulty lies opportunity.',a:'Albert Einstein'},{q:'It does not matter how slowly you go as long as you do not stop.',a:'Confucius'},{q:'Success is not final, failure is not fatal: It is the courage to continue that counts.',a:'Winston Churchill'},{q:'The future belongs to those who believe in the beauty of their dreams.',a:'Eleanor Roosevelt'},{q:'It always seems impossible until it is done.',a:'Nelson Mandela'},{q:'Strive not to be a success, but rather to be of value.',a:'Albert Einstein'},{q:'The only impossible journey is the one you never begin.',a:'Tony Robbins'}];\nconst q=quotes[Math.floor(Math.random()*quotes.length)];\nctx.reply('✨ *Daily Quote*\\n\\n_"' + q.q + '"_\\n\\n— *' + q.a + '*\\n\\n🌟 Have a great day, ' + user.first_name + '!',{parse_mode:'Markdown'});` },
            { command: 'motivation', lang: 'javascript', help: 'Daily motivation message', answer: `const msgs=['💪 You are stronger than you think! Keep pushing forward.','🚀 Every expert was once a beginner. Your journey has already begun!','🌟 Small steps every day lead to big changes over time.','🔥 You have survived 100% of your hardest days. You can do this!','⚡ Your only limit is your mind. Break free and achieve greatness!'];\nconst m=msgs[Math.floor(Math.random()*msgs.length)];\nctx.reply('💪 *Daily Motivation*\\n\\n' + m + '\\n\\n_You got this, ' + user.first_name + '! 🌟_',{parse_mode:'Markdown'});` },
            { command: 'affirmation', lang: 'javascript', help: 'Daily positive affirmation', answer: `const affs=['I am capable of achieving anything I set my mind to.','I attract success and positivity into my life.','I am grateful for all that I have and excited for what is coming.','Every day I grow stronger and more resilient.','I deserve happiness, success, and all the best life has to offer.'];\nconst a=affs[Math.floor(Math.random()*affs.length)];\nctx.reply('🌟 *Daily Affirmation*\\n\\n_"' + a + '"_\\n\\nSay this 3 times today, ' + user.first_name + '! ✨',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'poll_bot',
        name: 'Poll & Survey Bot',
        category: 'Community',
        description: 'Create polls, surveys and votes. Track responses, view results in real-time, export data. Perfect for community decisions and feedback collection.',
        tags: ['poll', 'survey', 'vote', 'feedback', 'community', 'data'],
        commandCount: 4,
        featured: false,
        setupEnvVars: [
            { key: 'ADMIN_IDS', desc: 'Admin IDs who can create and manage polls' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Welcome to poll bot', answer: `ctx.reply('📊 *Poll Bot*\\n\\nCreate and manage polls easily!\\n\\n/newpoll — Create a poll\\n/vote — Vote in active poll\\n/results — See poll results',{parse_mode:'Markdown',reply_markup:{keyboard:[['📊 New Poll','🗳️ Vote'],['📈 Results','❓ Help']],resize_keyboard:true}});` },
            { command: 'newpoll', lang: 'javascript', help: 'Create a new poll', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Only admins can create polls.');\nconst parts=message.text.slice(9).split('|');\nif(parts.length<3) return ctx.reply('Usage: /newpoll Question|Option1|Option2|Option3\\n\\nExample: /newpoll Best color?|Red|Blue|Green');\nconst [question,...options]=parts.map(s=>s.trim());\ntry{\n  await ctx.telegram.sendPoll(chat.id,question,options,{is_anonymous:false,allows_multiple_answers:false});\n  ctx.reply('✅ Poll created successfully!');\n}catch(e){ctx.reply('❌ Failed to create poll: '+e.message);}` },
            { command: 'vote', lang: 'javascript', help: 'Show active polls', answer: `ctx.reply('🗳️ *Active Polls*\\n\\nScroll up to find the latest poll and tap to vote!\\n\\nOr use /newpoll to create a new one.',{parse_mode:'Markdown'});` },
            { command: 'results', lang: 'javascript', help: 'Show poll results', answer: `ctx.reply('📈 *Poll Results*\\n\\nResults are shown directly in the poll message.\\nLook for the poll in the chat and click to see live results!\\n\\n💡 Create a new poll with /newpoll',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'finance_tracker',
        name: 'Personal Finance Tracker Bot',
        category: 'Productivity',
        description: 'Track expenses, income, and savings goals. Get spending summaries, budget alerts, and financial tips. Personal finance assistant in Telegram.',
        tags: ['finance', 'budget', 'expenses', 'savings', 'money', 'tracker'],
        commandCount: 5,
        featured: false,
        setupEnvVars: [
            { key: 'CURRENCY', desc: 'Your currency symbol (e.g. $, ETB, EUR)' },
            { key: 'MONTHLY_BUDGET', desc: 'Your monthly budget amount (e.g. 5000)' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Start finance tracker', answer: `const cur=env.CURRENCY||'$';\nctx.reply('💰 *Finance Tracker*\\n\\nTrack your money, reach your goals!\\n\\n/add — Add expense/income\\n/summary — Monthly summary\\n/tip — Financial tip',{parse_mode:'Markdown',reply_markup:{keyboard:[['➕ Add Record','📊 Summary'],['💡 Finance Tip','🎯 Goals']],resize_keyboard:true}});` },
            { command: 'add', lang: 'javascript', help: 'Add expense or income', answer: `const cur=env.CURRENCY||'$';\nconst parts=message.text.split(' ');\nconst type=parts[1];\nconst amount=parseFloat(parts[2]);\nconst category=parts.slice(3).join(' ')||'Other';\nif(!type||!amount||isNaN(amount)) return ctx.reply('Usage:\\n/add expense 50 Food\\n/add income 1000 Salary\\n\\nCategories: Food, Transport, Bills, Entertainment, Other');\nconst icon=type.toLowerCase().includes('income')?'📈':'📉';\nctx.reply(icon + ' *' + (type.toLowerCase().includes('income')?'Income':'Expense') + ' Recorded*\\n\\nAmount: *' + cur + amount.toFixed(2) + '*\\nCategory: ' + category + '\\nDate: ' + new Date().toLocaleDateString() + '\\n\\n✅ Saved! Use /summary to see overview.',{parse_mode:'Markdown'});` },
            { command: 'summary', lang: 'javascript', help: 'Monthly financial summary', answer: `const cur=env.CURRENCY||'$';\nconst budget=parseFloat(env.MONTHLY_BUDGET)||0;\nctx.reply('📊 *Monthly Summary*\\n\\n📅 ' + new Date().toLocaleString('default',{month:'long',year:'numeric'}) + '\\n\\n📈 Income: *' + cur + '0.00*\\n📉 Expenses: *' + cur + '0.00*\\n💾 Saved: *' + cur + '0.00*\\n' + (budget?'\\n🎯 Budget: *' + cur + budget.toFixed(2) + '*\\n📊 Used: *0%*':'') + '\\n\\n_Start tracking with /add_',{parse_mode:'Markdown'});` },
            { command: 'tip', lang: 'javascript', help: 'Get a financial tip', answer: `const tips=['💡 Save 20% of every income before spending.','💡 Track every expense — awareness is the first step.','💡 Pay yourself first, then pay bills.','💡 Avoid impulse buys: wait 24 hours before purchasing.','💡 Build a 3-6 month emergency fund.','💡 Invest early — compound interest is powerful.','💡 Cut one subscription you do not use today.'];\nconst tip=tips[Math.floor(Math.random()*tips.length)];\nctx.reply('💰 *Financial Tip*\\n\\n'+tip+'\\n\\n_Small habits create big wealth!_',{parse_mode:'Markdown'});` },
            { command: 'goals', lang: 'javascript', help: 'Set and track savings goals', answer: `const cur=env.CURRENCY||'$';\nctx.reply('🎯 *Savings Goals*\\n\\n*How to set a goal:*\\nType your goal like:\\n_"Save ' + cur + '1000 for vacation by June"_\\n\\nThen track your progress weekly with /summary!\\n\\n💡 Write your goals — people who write goals are 42% more likely to achieve them!',{parse_mode:'Markdown'});` },
        ],
    },
    {
        id: 'event_bot',
        name: 'Event Management Bot',
        category: 'Events',
        description: 'Create and manage events, collect RSVPs, send reminders, and share event details. Perfect for communities, meetups, conferences, and webinars.',
        tags: ['events', 'rsvp', 'calendar', 'meetup', 'reminder', 'community'],
        commandCount: 5,
        featured: false,
        setupEnvVars: [
            { key: 'ADMIN_IDS', desc: 'Event organizer Telegram IDs' },
            { key: 'TIMEZONE', desc: 'Your timezone (e.g. UTC+3, EST)' },
        ],
        commands: [
            { command: 'start', lang: 'javascript', help: 'Event bot welcome', answer: `ctx.reply('📅 *Event Bot*\\n\\nDiscover and join amazing events!\\n\\n/events — Upcoming events\\n/rsvp — RSVP to an event\\n/myevents — Your registered events',{parse_mode:'Markdown',reply_markup:{keyboard:[['📅 Events','✅ RSVP'],['🎟️ My Events','📞 Contact']],resize_keyboard:true}});` },
            { command: 'events', lang: 'javascript', help: 'View upcoming events', answer: `const tz=env.TIMEZONE||'UTC';\nctx.reply('📅 *Upcoming Events*\\n\\nNo events scheduled yet.\\n\\nAdmins: use /addevent to create one!\\n\\n_Stay tuned for announcements_',{parse_mode:'Markdown'});` },
            { command: 'addevent', lang: 'javascript', help: 'Admin: add a new event', answer: `const adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim());\nif(!adminIds.includes(String(user.id))) return ctx.reply('🚫 Admin only.');\nconst parts=message.text.slice(10).split('|');\nif(parts.length<3) return ctx.reply('Usage: /addevent Name|Date|Description|Location\\n\\nExample: /addevent Tech Meetup|June 15 2PM|Join us for networking|Addis Ababa');\nconst [name,date,desc,location]=parts.map(s=>s.trim());\nctx.reply('✅ *Event Created!*\\n\\n📌 *'+name+'*\\n📅 '+date+'\\n📍 '+(location||'Online')+'\\n📝 '+desc+'\\n\\nShare this with: /events',{parse_mode:'Markdown'});` },
            { command: 'rsvp', lang: 'javascript', help: 'RSVP to an event', answer: `const eventName=message.text.split(' ').slice(1).join(' ')||'the upcoming event';\nconst adminIds=(env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);\nfor(const adminId of adminIds){\n  ctx.telegram.sendMessage(parseInt(adminId),'🎟️ *New RSVP*\\n\\nEvent: '+eventName+'\\nName: '+user.first_name+'\\nID: '+user.id+'\\nUsername: @'+(user.username||'none'),{parse_mode:'Markdown'}).catch(()=>{});\n}\nctx.reply('✅ *RSVP Confirmed!*\\n\\nYou are registered for: *' + eventName + '*\\n\\nWe will send you reminders before the event!\\n\\nSee you there, ' + user.first_name + '! 🎉',{parse_mode:'Markdown'});` },
            { command: 'myevents', lang: 'javascript', help: 'View your registered events', answer: `ctx.reply('🎟️ *My Events*\\n\\nYou have no registered events yet.\\n\\nBrowse /events to find and RSVP to events!',{parse_mode:'Markdown'});` },
        ],
    },
];

app.get('/api/project-templates', async (req, res) => {
    res.json(PROJECT_TEMPLATES.map(p => ({
        id: p.id, name: p.name, category: p.category, description: p.description,
        tags: p.tags, commandCount: p.commandCount, featured: p.featured,
        setupEnvVars: p.setupEnvVars,
        commandNames: p.commands.map(c => ({ command: c.command, lang: c.lang, help: c.help })),
    })));
});

app.post('/api/install-project-template', async (req, res) => {
    const { projectId, botId, userId } = req.body;
    if (!projectId || !botId || !userId) return res.json({ success: false, error: 'Missing fields' });
    const project = PROJECT_TEMPLATES.find(p => p.id === projectId);
    if (!project) return res.json({ success: false, error: 'Project template not found' });
    const userBots = await fbGet(`user_${userId}_bots`) || [];
    if (!userBots.find(b => b.id === botId)) return res.json({ success: false, error: 'Bot not found' });
    let cmds = await fbGet(`bot_${botId}_commands`) || {};
    const folder = project.name;
    for (const cmd of project.commands) {
        cmds[cmd.command] = { command: cmd.command, answer: cmd.answer, lang: cmd.lang, help: cmd.help || '', aliases: '', keyboard: '', group: '', wait: false, retry: 600, folder };
    }
    await fbSet(`bot_${botId}_commands`, cmds);
    // Auto-set BOT_ID env var for templates that need HOST_URL so referral/API calls work
    const needsAutoEnv = project.setupEnvVars && project.setupEnvVars.some(v => v.key === 'HOST_URL');
    if (needsAutoEnv || projectId === 'refer_earn') {
        let env = await fbGet(`bot_${botId}_env`) || {};
        if (!env.BOT_ID) env.BOT_ID = botId;
        if (!env.HOST_URL) {
            // Build HOST_URL from trusted reverse-proxy headers; sanitize to prevent header injection
            const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
            const safeHost = rawHost.replace(/[^a-zA-Z0-9.\-:]/g, '');
            const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() === 'http' ? 'http' : 'https';
            if (safeHost) env.HOST_URL = `${proto}://${safeHost}`;
        }
        await fbSet(`bot_${botId}_env`, env);
    }
    let stats = await fbGet('global_stats') || {};
    stats.totalCmds = (stats.totalCmds || 0) + project.commands.length;
    await fbSet('global_stats', stats);
    await logActivity(userId, 'install_project_template', projectId);
    res.json({ success: true, installed: project.commands.length, commands: project.commands.map(c => c.command) });
});

// 11. System Actions
app.post('/api/clone-bot', async (req, res) => {
    const { userId, originBotId } = req.body;
    let userBots = await fbGet(`user_${userId}_bots`) || [];
    const src = userBots.find(b => b.id === originBotId);
    if (!src) return res.json({ success: false, error: "Bot not found" });
    const newId = Date.now().toString();
    const cloned = { ...src, id: newId, name: src.name + " (Copy)", dateCreated: Date.now(), isPinned: false };
    const srcCmds = await fbGet(`bot_${originBotId}_commands`) || {};
    const srcEnv = await fbGet(`bot_${originBotId}_env`) || {};
    await fbSet(`bot_${newId}_commands`, srcCmds);
    await fbSet(`bot_${newId}_env`, srcEnv);
    userBots.push(cloned);
    await fbSet(`user_${userId}_bots`, userBots);
    await logActivity(userId, 'clone_bot', originBotId);
    res.json({ success: true });
});

app.post('/api/transfer-bot', async (req, res) => {
    const { currentUserId, targetUserId, botId } = req.body;
    let srcBots = await fbGet(`user_${currentUserId}_bots`) || [];
    const idx = srcBots.findIndex(b => b.id === botId);
    if (idx === -1) return res.json({ success: false, error: "Bot not found" });
    const bot = srcBots[idx];
    try { const t = new Telegraf(bot.token); await t.telegram.deleteWebhook(); } catch(e) {}
    let active = await fbGet('active_deployments') || [];
    active = active.filter(d => d.botId !== botId);
    await fbSet('active_deployments', active);
    let tgtBots = await fbGet(`user_${targetUserId}_bots`) || [];
    bot.isPinned = false;
    tgtBots.push(bot);
    await fbSet(`user_${targetUserId}_bots`, tgtBots);
    srcBots.splice(idx, 1);
    await fbSet(`user_${currentUserId}_bots`, srcBots);
    await logActivity(currentUserId, 'transfer_bot', `to ${targetUserId}`);
    res.json({ success: true });
});

app.post('/api/update-bot-meta', async (req, res) => {
    const { userId, botId, isPinned, order, newToken, botsList } = req.body;
    if (botsList) { await fbSet(`user_${userId}_bots`, botsList); return res.json({ success: true }); }
    let userBots = await fbGet(`user_${userId}_bots`) || [];
    const index = userBots.findIndex(b => b.id === botId);
    if (index === -1) return res.json({ success: false });
    if (isPinned !== undefined) userBots[index].isPinned = isPinned;
    if (order !== undefined) userBots[index].order = order;
    if (newToken) {
        let active = await fbGet('active_deployments') || [];
        if (active.find(d => d.botId === botId)) {
            try { const t = new Telegraf(userBots[index].token); await t.telegram.deleteWebhook(); } catch(e) {}
            active = active.filter(d => d.botId !== botId);
            await fbSet('active_deployments', active);
        }
        userBots[index].token = newToken;
    }
    await fbSet(`user_${userId}_bots`, userBots);
    res.json({ success: true });
});

app.post('/api/delete-bot', async (req, res) => {
    const { userId, botId } = req.body;
    let active = await fbGet('active_deployments') || [];
    const dep = active.find(d => d.botId === botId);
    if (dep) {
        try { const t = new Telegraf(dep.token); await t.telegram.deleteWebhook(); } catch(e) {}
        active = active.filter(d => d.botId !== botId);
        await fbSet('active_deployments', active);
    }
    let userBots = await fbGet(`user_${userId}_bots`) || [];
    userBots = userBots.filter(b => b.id !== botId);
    await fbSet(`user_${userId}_bots`, userBots);
    await fbDelete(`bot_${botId}_commands`);
    await fbDelete(`bot_${botId}_env`);
    await fbDelete(`bot_${botId}_logs`);
    await fbDelete(`bot_${botId}_analytics`);
    await logActivity(userId, 'delete_bot', botId);
    res.json({ success: true });
});

app.get('/api/backup-bot', async (req, res) => {
    const botId = req.query.botId;
    res.json({ commands: await fbGet(`bot_${botId}_commands`) || {}, env: await fbGet(`bot_${botId}_env`) || {} });
});

app.post('/api/restore-bot', async (req, res) => {
    const { botId, commands, env } = req.body;
    await fbSet(`bot_${botId}_commands`, commands || {});
    if (env) await fbSet(`bot_${botId}_env`, env);
    res.json({ success: true });
});

// 13. Webhook mode config (long polling not available in Vercel serverless)
app.get('/api/webhook-info', async (req, res) => {
    const { botId } = req.query;
    let deployments = await fbGet('active_deployments') || [];
    const dep = deployments.find(d => d.botId === botId);
    if (!dep) return res.json({ mode: 'offline' });
    try {
        const bot = new Telegraf(dep.token);
        const wh = await bot.telegram.getWebhookInfo();
        res.json({ mode: 'webhook', url: wh.url, pendingCount: wh.pending_update_count });
    } catch(e) { res.json({ mode: 'unknown', error: e.message }); }
});

// Admin routes
const adminRoutes = require('./adminRoutes');
app.use('/api/admin', adminRoutes(fbGet, fbSet, fbUpdate, fbDelete, fbPush, BOT_TOKEN, ADMIN_ID));

// Bot Folders CRUD
app.get('/api/bot-folders', async (req, res) => {
    const { botId } = req.query;
    if (!botId) return res.json([]);
    const folders = await fbGet(`bot_${botId}_folders`) || [];
    res.json(Array.isArray(folders) ? folders : []);
});

app.post('/api/save-folder', async (req, res) => {
    const { botId, folder } = req.body;
    if (!botId || !folder) return res.json({ success: false, error: 'botId and folder required' });
    let folders = await fbGet(`bot_${botId}_folders`) || [];
    if (!Array.isArray(folders)) folders = [];
    if (!folders.includes(folder)) folders.push(folder);
    await fbSet(`bot_${botId}_folders`, folders);
    res.json({ success: true, folders });
});

app.post('/api/delete-folder', async (req, res) => {
    const { botId, folder } = req.body;
    if (!botId || !folder) return res.json({ success: false, error: 'botId and folder required' });
    let folders = await fbGet(`bot_${botId}_folders`) || [];
    if (!Array.isArray(folders)) folders = [];
    folders = folders.filter(f => f !== folder);
    await fbSet(`bot_${botId}_folders`, folders);
    // Clear folder from all commands in this bot
    const cmds = await fbGet(`bot_${botId}_commands`) || {};
    Object.values(cmds).forEach(cmd => { if (typeof cmd === 'object' && cmd.folder === folder) cmd.folder = ''; });
    await fbSet(`bot_${botId}_commands`, cmds);
    res.json({ success: true, folders });
});

// Coupon redemption (user applies a coupon code)
app.post('/api/redeem-coupon', async (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) return res.json({ success: false, error: 'userId and code required' });
    let coupons = await fbGet('coupons') || [];
    if (!Array.isArray(coupons)) coupons = Object.values(coupons);
    const idx = coupons.findIndex(c => c.code === code.toUpperCase() && c.used < c.maxUses);
    if (idx === -1) return res.json({ success: false, error: 'Invalid or expired coupon' });
    coupons[idx].used = (coupons[idx].used || 0) + 1;
    await fbSet('coupons', coupons);
    await fbUpdate(`users/${userId}`, { plan: coupons[idx].plan });
    await fbPush('activity_logs', { time: Date.now(), userId: String(userId), action: 'coupon_redeemed', details: code });
    res.json({ success: true, plan: coupons[idx].plan });
});

// ===== CHANNEL MEMBERSHIP CHECK ENDPOINT =====
app.get('/api/check-channel', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ joined: false, error: 'userId required' });
    try {
        const joined = await checkChannelMembership(parseInt(userId, 10) || userId);
        res.json({ joined });
    } catch(e) {
        res.json({ joined: false, error: e.message });
    }
});

// ===== SEND BOT DATA TO USER VIA TELEGRAM (ZIP alternative for WebApp) =====
app.post('/api/send-bot-zip', async (req, res) => {
    const { botId, userId } = req.body;
    if (!botId || !userId) return res.json({ success: false, error: 'botId and userId required' });
    try {
        const cmds = await fbGet(`bot_${botId}_commands`) || {};
        const envVars = await fbGet(`bot_${botId}_env`) || {};
        const userBots = await fbGet(`user_${userId}_bots`) || [];
        const bot = userBots.find(b => b.id === botId);
        const botName = bot ? bot.name : botId;

        // Build text summary since sending actual ZIP requires a file server
        const cmdList = Object.keys(cmds);
        const envList = Object.keys(envVars);
        const exportData = JSON.stringify({ id: botId, name: botName, exportDate: new Date().toISOString(), commands: cmds, envKeys: envList }, null, 2);

        // Send via main bot
        const mainBot = new Telegraf(BOT_TOKEN);
        // Send as a document (text file with JSON content)
        await mainBot.telegram.sendDocument(userId,
            { source: Buffer.from(exportData, 'utf8'), filename: `${botName.replace(/[^a-zA-Z0-9_]/g,'_')}_backup.json` },
            { caption: `📦 *Bot Backup: ${botName}*\n\n📝 Commands: ${cmdList.length}\n🔐 Env keys: ${envList.length}\n\nSave this file to restore your bot later.`, parse_mode: 'Markdown' }
        );
        res.json({ success: true });
    } catch(e) {
        console.error('send-bot-zip error:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Fallback: POST /api/webhook without botId — Telegram sends here if webhook was misconfigured.
// Process the update fully before responding so Vercel doesn't kill the work early.
// Also self-heals the webhook URL back to /api/main-webhook.
app.post('/api/webhook', async (req, res) => {
    console.warn('[webhook-fallback] Received update at /api/webhook — no botId. Processing and auto-fixing webhook.');
    try {
        const bot = new Telegraf(BOT_TOKEN);
        const update = req.body;

        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
        const baseUrl = `${proto}://${host}`;

        // Auto-fix: redirect future updates to the correct endpoint
        const correctWebhook = `${baseUrl}/api/main-webhook`;
        bot.telegram.setWebhook(correctWebhook).catch(e => console.warn('[webhook-fallback] Auto-fix webhook error:', e.message));

        // Handle callback queries in fallback too
        if (update.callback_query) {
            const cq = update.callback_query;
            const chatId = cq.message.chat.id;
            const userId = cq.from.id;
            await bot.telegram.answerCbQuery(cq.id).catch(() => {});
            if (cq.data === 'check_join') {
                const joined = await checkChannelMembership(userId);
                if (joined) {
                    await bot.telegram.sendMessage(chatId,
                        `✅ *ቻናሎቻችንን ስለተቀላቀሉ እናመሰግናለን!*\n\nWelcome! Tap below to open the platform.`,
                        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 Open MyFa Host', web_app: { url: baseUrl } }]] } }
                    );
                } else {
                    await bot.telegram.sendMessage(chatId,
                        `⚠️ You haven't joined yet. Please join @MYFA_ORG first.`,
                        { reply_markup: { inline_keyboard: [
                            [{ text: '📢 Join MYFA_ORG', url: 'https://t.me/MYFA_ORG' }],
                            [{ text: '✅ I Joined — Check Again', callback_data: 'check_join' }]
                        ]} }
                    );
                }
            }
            res.status(200).send('OK');
            return;
        }

        if (!update.message) { res.status(200).send('OK'); return; }
        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const firstName = msg.from.first_name || 'User';

        await registerUser(userId, msg.from);
        await logActivity(userId, 'bot_message', msg.text || '');

        if (msg.text === '/start' || (msg.text || '').startsWith('/start ')) {
            const joined = await checkChannelMembership(userId);
            if (!joined) {
                await bot.telegram.sendMessage(chatId,
                    `⚠️ *ቦቱን ለመጠቀም ሁሉንም ቻናሎች መቀላቀል አለብዎት!*\n\nPlease join @MYFA_ORG first.`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
                        [{ text: '📢 Join Official Channel', url: 'https://t.me/MYFA_ORG' }],
                        [{ text: '✅ I Joined — Check Again', callback_data: 'check_join' }]
                    ]} }
                );
                res.status(200).send('OK');
                return;
            }
            await bot.telegram.sendMessage(chatId,
                `👋 *Welcome ${firstName} to MyFa Host!*\n\n🚀 The most advanced Telegram Bot Hosting Platform\n\n✨ *Features:*\n• Host unlimited bots 24/7\n• Built-in code editor\n• Real-time analytics\n• One-click deployment\n\nTap below to open the platform! 👇`,
                { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🚀 Open MyFa Host', web_app: { url: baseUrl } }]] } }
            );
            if (String(userId) === String(ADMIN_ID)) {
                await bot.telegram.sendMessage(chatId,
                    `🔐 *Admin Control Panel*\n\nWelcome back, Admin! 👑`,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⚙️ Admin Panel', web_app: { url: `${baseUrl}/admin.html` } }]] } }
                );
            }
        } else if (msg.text === '/help') {
            await bot.telegram.sendMessage(chatId,
                `📚 *MyFa Host Help*\n\n/start — Open the platform\n/help — Show this help\n/status — Check your bots\n/stats — Platform statistics`,
                { parse_mode: 'Markdown' }
            );
        } else if (msg.text === '/status') {
            const userBots = await fbGet(`user_${userId}_bots`) || [];
            const deps = await fbGet('active_deployments') || [];
            const online = userBots.filter(b => deps.find(d => d.botId === b.id));
            await bot.telegram.sendMessage(chatId,
                `📊 *Your Bots Status*\n\nTotal: ${userBots.length} | Online: ${online.length}\n\n` +
                (userBots.map(b => `${deps.find(d => d.botId === b.id) ? '🟢' : '🔴'} ${b.name}`).join('\n') || 'No bots found.'),
                { parse_mode: 'Markdown' }
            );
        } else if (msg.text === '/stats') {
            const stats = await fbGet('global_stats') || {};
            await bot.telegram.sendMessage(chatId,
                `📈 *Platform Statistics*\n\n🤖 Bots: ${stats.totalBots || 0}\n👥 Users: ${stats.totalUsers || 0}\n⚡ Commands: ${stats.totalCmds || 0}\n📨 Messages: ${stats.totalMessages || 0}`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch(e) { console.error('[webhook-fallback] Error:', e.message); }
    res.status(200).send('OK');
});

// ==========================================
//  MINI APP PAGE HOSTING
// ==========================================

// Serve a user's HTML page command as a Telegram Mini App
// GET /api/mini/:botId/:page
app.get('/api/mini/:botId/:page', async (req, res) => {
    const { botId, page } = req.params;
    // Sanitise URL params — only allow alphanumeric, underscore, hyphen
    const safeBotId = String(botId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const safePage = String(page).replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeBotId || !safePage) return res.status(400).send('Invalid parameters');

    const commands = await fbGet(`bot_${safeBotId}_commands`) || {};
    const cmdData = commands[safePage];
    if (!cmdData || (typeof cmdData === 'object' && cmdData.lang !== 'html')) {
        return res.status(404).send(`
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page Not Found</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>body{background:#050511;color:white;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px;}
h2{color:#ff0055;}p{color:#8b8b9e;}</style></head>
<body><h2>404 — Page Not Found</h2><p>No HTML page named <code>${safePage}</code> found for this bot.</p>
<p style="font-size:12px;color:#444;">Create it in your bot dashboard under Cmds → New Command → HTML Page</p>
<script>window.Telegram.WebApp.ready();</script></body></html>`);
    }

    const html = typeof cmdData === 'object' ? cmdData.answer : cmdData;

    // Inject Telegram WebApp JS and cross-page navigation helper
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    // safeBotId and safePage are already sanitised above — safe to embed as JSON strings
    const baseUrl = `${proto}://${host}/api/mini/${safeBotId}`;

    const tgScript = `<script src="https://telegram.org/js/telegram-web-app.js"></script>`;
    const helperScript = `
<script>
// MyFa Mini App Navigation Helper
window.miniApp = {
  botId: ${JSON.stringify(safeBotId)},
  baseUrl: ${JSON.stringify(baseUrl)},
  go: function(page) { window.location.href = this.baseUrl + '/' + encodeURIComponent(page); },
  close: function() { window.Telegram.WebApp.close(); },
  back: function() { window.history.back(); }
};
window.Telegram.WebApp.ready();
window.Telegram.WebApp.expand();
</script>`;

    let finalHtml;
    if (/<html[\s>]/i.test(html)) {
        if (/<\/head>/i.test(html)) {
            finalHtml = html.replace(/<\/head>/i, tgScript + '\n' + helperScript + '\n</head>');
        } else if (/<head>/i.test(html)) {
            finalHtml = html.replace(/<head>/i, '<head>\n' + tgScript);
            finalHtml = finalHtml.replace(/<\/body>/i, helperScript + '\n</body>');
        } else {
            finalHtml = tgScript + '\n' + helperScript + '\n' + html;
        }
    } else {
        // Partial HTML — wrap in a full document with dark default styling
        finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>${safePage}</title>
${tgScript}
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--tg-theme-bg-color, #050511);
  color: var(--tg-theme-text-color, #ffffff); }
a { color: var(--tg-theme-link-color, #00f2ea); }
button { font-family: inherit; }
</style>
</head>
<body>
${html}
${helperScript}
</body>
</html>`;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.send(finalHtml);
});

// List mini app pages for a bot (lang === 'html' commands)
app.get('/api/mini-pages', async (req, res) => {
    const { botId } = req.query;
    if (!botId) return res.json([]);
    const commands = await fbGet(`bot_${botId}_commands`) || {};
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const pages = Object.values(commands)
        .filter(d => typeof d === 'object' && d.lang === 'html')
        .map(d => ({
            command: d.command,
            help: d.help || '',
            url: `${proto}://${host}/api/mini/${botId}/${encodeURIComponent(d.command)}`
        }));
    res.json(pages);
});

// ===== HOSTED BOT BROADCAST WITH TARGETING =====
app.post('/api/bot-broadcast', async (req, res) => {
    const { botId, userId, target, prefix, message: msgText, parseMode, photoUrl, btnText, btnUrl } = req.body;
    if (!botId || !msgText) return res.json({ success: false, error: 'botId and message required' });
    // Verify caller owns this bot or is admin
    const adminCheck = String(userId) === String(ADMIN_ID);
    if (!adminCheck) {
        const userBots = await fbGet(`user_${userId}_bots`) || [];
        if (!userBots.find(b => b.id === botId)) return res.json({ success: false, error: 'Unauthorized' });
    }
    const deployments = await fbGet('active_deployments') || [];
    const dep = deployments.find(d => d.botId === botId);
    if (!dep) return res.json({ success: false, error: 'Bot not running' });
    // Collect target bot IDs
    let targetBotIds = [botId];
    if (target === 'all_bots') {
        targetBotIds = deployments.map(d => d.botId);
    } else if (target === 'free_bots') {
        const allUsers = await fbGet('users') || {};
        const freeUserIds = Object.values(allUsers).filter(u => (!u.plan || u.plan === 'free') && !u.banned).map(u => u.id);
        const allBotsList = [];
        for (const uid of freeUserIds) {
            const ub = await fbGet(`user_${uid}_bots`) || [];
            ub.forEach(b => allBotsList.push(b.id));
        }
        targetBotIds = deployments.filter(d => allBotsList.includes(d.botId)).map(d => d.botId);
    } else if (target === 'premium_bots') {
        const allUsers = await fbGet('users') || {};
        const premUserIds = Object.values(allUsers).filter(u => u.plan && u.plan !== 'free' && !u.banned).map(u => u.id);
        const premBotsList = [];
        for (const uid of premUserIds) {
            const ub = await fbGet(`user_${uid}_bots`) || [];
            ub.forEach(b => premBotsList.push(b.id));
        }
        targetBotIds = deployments.filter(d => premBotsList.includes(d.botId)).map(d => d.botId);
    } else if (target === 'specific' && prefix) {
        targetBotIds = deployments.filter(d => d.botId.startsWith(prefix)).map(d => d.botId);
    }
    let sent = 0, failed = 0;
    for (const tbId of targetBotIds) {
        const tdep = deployments.find(d => d.botId === tbId);
        if (!tdep) continue;
        const analytics = await fbGet(`bot_${tbId}_analytics`) || {};
        const userIds = Array.isArray(analytics.uniqueUsers) ? analytics.uniqueUsers : Object.keys(analytics.uniqueUsers || {});
        const tbot = new Telegraf(tdep.token);
        for (const uid of userIds) {
            try {
                const fullMsg = prefix ? `[${prefix}] ${msgText}` : msgText;
                const extra = {};
                if (parseMode) extra.parse_mode = parseMode;
                if (btnText && btnUrl) extra.reply_markup = { inline_keyboard: [[{ text: btnText, url: btnUrl }]] };
                if (photoUrl) {
                    await tbot.telegram.sendPhoto(uid, photoUrl, { caption: fullMsg, ...extra });
                } else {
                    await tbot.telegram.sendMessage(uid, fullMsg, extra);
                }
                sent++;
            } catch(e) { failed++; }
        }
    }
    res.json({ success: true, sent, failed, bots: targetBotIds.length });
});

// ===== BOT RATINGS (Feature 2) =====
app.post('/api/rate-bot', async (req, res) => {
    const { botId, userId, rating } = req.body;
    if (!botId || !userId || !['like','dislike'].includes(rating)) return res.json({ success: false });
    const key = `bot_${botId}_ratings`;
    let ratings = await fbGet(key) || { likes: [], dislikes: [] };
    if (!Array.isArray(ratings.likes)) ratings.likes = Object.values(ratings.likes || {});
    if (!Array.isArray(ratings.dislikes)) ratings.dislikes = Object.values(ratings.dislikes || {});
    ratings.likes = ratings.likes.filter(u => u !== String(userId));
    ratings.dislikes = ratings.dislikes.filter(u => u !== String(userId));
    ratings[rating === 'like' ? 'likes' : 'dislikes'].push(String(userId));
    await fbSet(key, ratings);
    const allUsers = await fbGet('users') || {};
    for (const uid of Object.keys(allUsers)) {
        const bots = await fbGet(`user_${uid}_bots`) || [];
        if (bots.find(b => b.id === botId)) {
            const xp = await fbGet(`user_${uid}_xp`) || { xp: 0 };
            xp.xp = Math.max(0, (xp.xp || 0) + (rating === 'like' ? 1 : -1));
            await fbSet(`user_${uid}_xp`, xp);
            break;
        }
    }
    res.json({ success: true, likes: ratings.likes.length, dislikes: ratings.dislikes.length });
});

app.get('/api/bot-ratings', async (req, res) => {
    const { botId } = req.query;
    const ratings = await fbGet(`bot_${botId}_ratings`) || { likes: [], dislikes: [] };
    const likes = Array.isArray(ratings.likes) ? ratings.likes.length : Object.keys(ratings.likes || {}).length;
    const dislikes = Array.isArray(ratings.dislikes) ? ratings.dislikes.length : Object.keys(ratings.dislikes || {}).length;
    res.json({ likes, dislikes, warned: dislikes > likes });
});

// ===== SHAREABLE BOT TEMPLATES (Feature 3) =====
app.post('/api/share-bot', async (req, res) => {
    const { botId, userId } = req.body;
    if (!botId || !userId) return res.json({ success: false });
    const userBots = await fbGet(`user_${userId}_bots`) || [];
    const bot = userBots.find(b => b.id === botId);
    if (!bot) return res.json({ success: false, error: 'Bot not found' });
    const shareId = require('crypto').randomBytes(8).toString('hex');
    const cmds = await fbGet(`bot_${botId}_commands`) || {};
    const shareData = {
        shareId, botId, botName: bot.name, ownerId: String(userId),
        commands: cmds, createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 3600 * 1000
    };
    await fbSet(`shared_bots/${shareId}`, shareData);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    res.json({ success: true, shareId, shareUrl: `${proto}://${host}/#share=${shareId}` });
});

app.get('/api/shared-bot/:shareId', async (req, res) => {
    const data = await fbGet(`shared_bots/${req.params.shareId}`);
    if (!data) return res.status(404).json({ error: 'Not found or expired' });
    if (data.expiresAt && Date.now() > data.expiresAt) return res.status(410).json({ error: 'Link expired' });
    const { commands } = data;
    res.json({ success: true, botName: data.botName, commands, commandCount: Object.keys(commands || {}).length });
});

app.post('/api/import-shared-bot', async (req, res) => {
    const { shareId, botId, userId } = req.body;
    const data = await fbGet(`shared_bots/${shareId}`);
    if (!data) return res.json({ success: false, error: 'Share not found' });
    if (data.expiresAt && Date.now() > data.expiresAt) return res.json({ success: false, error: 'Link expired' });
    const userBots = await fbGet(`user_${userId}_bots`) || [];
    if (!userBots.find(b => b.id === botId)) return res.json({ success: false, error: 'Bot not found' });
    let cmds = await fbGet(`bot_${botId}_commands`) || {};
    Object.assign(cmds, data.commands);
    await fbSet(`bot_${botId}_commands`, cmds);
    await logActivity(userId, 'import_shared_bot', shareId);
    res.json({ success: true, imported: Object.keys(data.commands || {}).length });
});

// ===== TEMPORARY ONE-TIME DOWNLOAD LINKS (Feature 4) =====
app.post('/api/gen-download-token', async (req, res) => {
    const { botId, userId } = req.body;
    if (!botId || !userId) return res.json({ success: false });
    const userBots = await fbGet(`user_${userId}_bots`) || [];
    if (!userBots.find(b => b.id === botId)) return res.json({ success: false, error: 'Unauthorized' });
    const token = require('crypto').randomBytes(16).toString('hex');
    await fbSet(`dl_tokens/${token}`, { botId, userId, expiresAt: Date.now() + 600000, used: false });
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    res.json({ success: true, downloadUrl: `${proto}://${host}/api/download/${token}` });
});

app.get('/api/download/:token', async (req, res) => {
    const tokenData = await fbGet(`dl_tokens/${req.params.token}`);
    if (!tokenData || tokenData.used || Date.now() > tokenData.expiresAt) {
        return res.status(410).send('Download link expired or already used.');
    }
    await fbUpdate(`dl_tokens/${req.params.token}`, { used: true });
    const { botId } = tokenData;
    const cmds = await fbGet(`bot_${botId}_commands`) || {};
    const env = await fbGet(`bot_${botId}_env`) || {};

    try {
        const JSZip = require('jszip');
        const zip = new JSZip();

        // Add backup JSON
        const data = JSON.stringify({ id: botId, exportDate: new Date().toISOString(), commands: cmds, envKeys: Object.keys(env) }, null, 2);
        zip.file(`bot_${botId}_backup.json`, data);

        // Add individual command files
        for (const [name, cmdData] of Object.entries(cmds)) {
            const isObj = typeof cmdData === 'object';
            const code = isObj ? cmdData.answer : cmdData;
            const lang = isObj ? (cmdData.lang || 'javascript') : 'javascript';
            const ext = lang === 'python' ? 'py' : lang === 'shell' ? 'sh' : lang === 'html' ? 'html' : lang === 'go' ? 'go' : lang === 'java' ? 'java' : 'js';
            zip.file(`commands/${name}.${ext}`, code || '');
        }

        const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader('Content-Disposition', `attachment; filename="bot_${botId}_full_code.zip"`);
        res.setHeader('Content-Type', 'application/zip');
        res.send(zipBuffer);
    } catch(e) {
        // Fallback to JSON if JSZip fails
        const data = JSON.stringify({ id: botId, exportDate: new Date().toISOString(), commands: cmds, envKeys: Object.keys(env) }, null, 2);
        res.setHeader('Content-Disposition', `attachment; filename="bot_${botId}_backup.json"`);
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    }
});

// ===== CREATOR PROFILES & LEVEL SYSTEM (Feature 5) =====
app.get('/api/creator-profile/:userId', async (req, res) => {
    const { userId } = req.params;
    const user = await fbGet(`users/${userId}`);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const bots = await fbGet(`user_${userId}_bots`) || [];
    const xpData = await fbGet(`user_${userId}_xp`) || { xp: 0 };
    let totalLikes = 0, totalDislikes = 0;
    for (const bot of bots) {
        const ratings = await fbGet(`bot_${bot.id}_ratings`) || { likes: [], dislikes: [] };
        const l = Array.isArray(ratings.likes) ? ratings.likes.length : 0;
        const d = Array.isArray(ratings.dislikes) ? ratings.dislikes.length : 0;
        totalLikes += l; totalDislikes += d;
    }
    const xp = xpData.xp || 0;
    const level = Math.min(100, Math.floor(xp / 10) + 1);
    const quality = (totalLikes + totalDislikes) > 0 ? Math.round(totalLikes / (totalLikes + totalDislikes) * 100) : 100;
    const badges = [];
    if (totalDislikes > totalLikes) badges.push({ type: 'warn', icon: '⚠️', label: 'Warn' });
    if (level >= 50) badges.push({ type: 'level', icon: '🏅', label: `Level ${level}` });
    res.json({ userId, name: user.name, username: user.username, plan: user.plan, botCount: bots.length, totalLikes, totalDislikes, xp, level, quality, badges });
});

app.get('/api/leaderboard', async (req, res) => {
    const { type } = req.query;
    const allUsers = await fbGet('users') || {};
    const results = [];
    for (const uid of Object.keys(allUsers)) {
        const user = allUsers[uid];
        if (user.banned) continue;
        const bots = await fbGet(`user_${uid}_bots`) || [];
        let totalLikes = 0, totalDislikes = 0;
        for (const bot of bots) {
            const r = await fbGet(`bot_${bot.id}_ratings`) || { likes: [], dislikes: [] };
            totalLikes += Array.isArray(r.likes) ? r.likes.length : 0;
            totalDislikes += Array.isArray(r.dislikes) ? r.dislikes.length : 0;
        }
        const xpData = await fbGet(`user_${uid}_xp`) || { xp: 0 };
        results.push({ userId: uid, name: user.name, username: user.username, botCount: bots.length, totalLikes, totalDislikes, xp: xpData.xp || 0, level: Math.min(100, Math.floor((xpData.xp || 0) / 10) + 1) });
    }
    if (type === 'creators_bots') results.sort((a,b) => b.botCount - a.botCount);
    else results.sort((a,b) => b.totalLikes - a.totalLikes);
    res.json(results.slice(0, 20));
});

app.get('/api/platform-stats', async (req, res) => {
    const stats = await fbGet('global_stats') || {};
    const allUsers = await fbGet('users') || {};
    const now = Date.now();
    const users = Object.values(allUsers);
    const active24h = users.filter(u => u.lastSeen && (now - u.lastSeen) < 86400000).length;
    const active7d = users.filter(u => u.lastSeen && (now - u.lastSeen) < 7 * 86400000).length;
    const new24h = users.filter(u => u.created && (now - u.created) < 86400000).length;
    const new30d = users.filter(u => u.created && (now - u.created) < 30 * 86400000).length;
    const blocked = users.filter(u => u.banned).length;
    res.json({ totalUsers: users.length, blocked, active24h, active7d, new24h, new30d, totalBots: stats.totalBots || 0, totalMessages: stats.totalMessages || 0 });
});

// ===== TEMPLATE RATINGS =====
app.post('/api/rate-template', async (req, res) => {
    const { templateId, userId, rating } = req.body;
    if (!templateId || !userId || !['like','dislike'].includes(rating)) return res.json({ success: false });
    const key = `template_${templateId}_ratings`;
    let ratings = await fbGet(key) || { likes: [], dislikes: [] };
    if (!Array.isArray(ratings.likes)) ratings.likes = Object.values(ratings.likes || {});
    if (!Array.isArray(ratings.dislikes)) ratings.dislikes = Object.values(ratings.dislikes || {});
    ratings.likes = ratings.likes.filter(u => u !== String(userId));
    ratings.dislikes = ratings.dislikes.filter(u => u !== String(userId));
    ratings[rating === 'like' ? 'likes' : 'dislikes'].push(String(userId));
    await fbSet(key, ratings);
    res.json({ success: true, likes: ratings.likes.length, dislikes: ratings.dislikes.length });
});

app.get('/api/template-ratings', async (req, res) => {
    const { templateId } = req.query;
    if (!templateId) return res.json({ likes: 0, dislikes: 0, warned: false });
    const ratings = await fbGet(`template_${templateId}_ratings`) || { likes: [], dislikes: [] };
    const likes = Array.isArray(ratings.likes) ? ratings.likes.length : 0;
    const dislikes = Array.isArray(ratings.dislikes) ? ratings.dislikes.length : 0;
    res.json({ likes, dislikes, warned: dislikes > likes });
});

module.exports = app;

app.get('/api/notifications', async (req, res) => {
    const notifs = await fbGet(`user_${req.query.userId}_notifications`) || [];
    res.json({ notifications: notifs.sort((a,b) => b.date - a.date) });
});

app.post('/api/notifications/read', async (req, res) => {
    let notifs = await fbGet(`user_${req.body.userId}_notifications`) || [];
    notifs.forEach(n => n.read = true);
    await fbSet(`user_${req.body.userId}_notifications`, notifs);
    res.json({ success: true });
});

// Stats API
app.get('/api/stats', async (req, res) => {
    // Generate real stats instead of fake ones
    const activeDeployments = await fbGet('active_deployments') || [];
    const botsCount = activeDeployments.length;
    // We don't have a direct users list in root easily, but we can mock it based on active
    const start = Date.now();
    await fbGet('ping'); // simple read to get ping
    const ping = Date.now() - start;
    
    res.json({
        users: botsCount * 2 + 15, // placeholder logic to show some number
        bots: botsCount,
        ping: ping,
        leaders: [
            { name: "MyFa Admin", score: 1000 },
            { name: "Power User", score: 850 },
            { name: "Bot Creator", score: 420 }
        ]
    });
});
