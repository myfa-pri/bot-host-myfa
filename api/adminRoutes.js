/**
 * Admin Routes — MyFa Host
 * Mounted at /api/admin/*
 */
const express = require('express');
const { Telegraf } = require('telegraf');

module.exports = function adminRoutes(
    fbGet,
    fbSet,
    fbUpdate,
    fbDelete,
    fbPush,
    BOT_TOKEN,
    ADMIN_ID
) {
    const router = express.Router();

    const ADMIN_IDS = [...new Set(
        [
            '673766598',
            '6941014837',
            ...(Array.isArray(ADMIN_ID) ? ADMIN_ID : [ADMIN_ID])
        ]
            .filter(id => id !== undefined && id !== null)
            .map(String)
    )];

    function toArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
}

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

function sanitizeIdentifier(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function normalizeAdminEntries(value) {
    return uniqueStrings(value)
        .map(item => item.replace(/^@/, ''))
        .slice(0, 10);
}

async function logAdmin(req, action, details = '') {
    return writeActivity(req, action, details);
}

function uniqueStrings(value) {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(',');

    return [...new Set(
        values
            .map(item => String(item).trim())
            .filter(Boolean)
    )];
}
    function getAnalyticsUserIds(analytics) {
        if (Array.isArray(analytics?.uniqueUsers)) {
            return uniqueStrings(analytics.uniqueUsers);
        }

        if (
            analytics?.uniqueUsers &&
            typeof analytics.uniqueUsers === 'object'
        ) {
            return uniqueStrings(Object.keys(analytics.uniqueUsers));
        }

        return [];
    }

    function getAdminId(req) {
        return String(
            req.query.adminId ||
            req.body?.adminId ||
            ''
        );
    }

    async function writeActivity(req, action, details) {
        await fbPush('activity_logs', {
            time: Date.now(),
            userId: getAdminId(req),
            action,
            details: details || ''
        });
    }

    async function getAllBotsWithOwners() {
        const allUsers = await fbGet('users') || {};
        const deployments = toArray(
            await fbGet('active_deployments')
        );
        const result = [];

        for (const [uid, user] of Object.entries(allUsers)) {
            const bots = toArray(
                await fbGet(`user_${uid}_bots`)
            );

            for (const bot of bots) {
                const deployment = deployments.find(
                    item => String(item.botId) === String(bot.id)
                );

                result.push({
                    ...bot,
                    ownerUserId: String(uid),
                    ownerName: user?.name || String(uid),
                    ownerUsername: user?.username || '',
                    status: deployment ? 'Online' : 'Offline',
                    startTime: deployment?.startTime || null
                });
            }
        }

        return result;
    }

    async function findBot(botId) {
        const allUsers = await fbGet('users') || {};

        for (const [uid, user] of Object.entries(allUsers)) {
            const bots = toArray(
                await fbGet(`user_${uid}_bots`)
            );
            const bot = bots.find(
                item => String(item.id) === String(botId)
            );

            if (bot) {
                return {
                    bot,
                    bots,
                    ownerUserId: String(uid),
                    owner: user || {}
                };
            }
        }

        return null;
    }

    async function saveBroadcastHistory(data) {
        return fbPush('broadcast_history', {
            id: data.id || `broadcast_${Date.now()}`,
            time: data.time || Date.now(),
            finishedAt: data.finishedAt || Date.now(),
            message: data.message || '',
            target: data.target || 'all',
            total: Number(data.total || 0),
            processed: Number(data.processed || 0),
            progress: Number(data.progress || 0),
            sent: Number(data.sent || 0),
            errors: Number(data.errors ?? data.failed ?? 0),
            failed: Number(data.failed ?? data.errors ?? 0),
            speed: Number(data.speed || 0),
            status: data.status || 'completed',
            sender: String(data.sender || '')
        });
    }

    // Middleware: verify caller is one of the configured admins.
    function requireAdmin(req, res, next) {
        const id = getAdminId(req);

        if (!ADMIN_IDS.includes(id)) {
            return res.status(403).json({
                error: 'Forbidden'
            });
        }

        req.adminId = id;
        next();
    }

    router.use(requireAdmin);

    // ===== DASHBOARD STATS =====
    router.get('/stats', async (req, res) => {
        try {
            const [
                storedStats,
                allUsers,
                allDeps,
                logs,
                allBots
            ] = await Promise.all([
                fbGet('global_stats'),
                fbGet('users'),
                fbGet('active_deployments'),
                fbGet('activity_logs'),
                getAllBotsWithOwners()
            ]);

            const stats = storedStats || {};
            const users = allUsers || {};
            const deployments = toArray(allDeps);
            const logArr = toArray(logs);

            let totalCommands = 0;
            let totalMessages = 0;

            await Promise.all(
                allBots.map(async bot => {
                    const [commands, analytics] = await Promise.all([
                        fbGet(`bot_${bot.id}_commands`),
                        fbGet(`bot_${bot.id}_analytics`)
                    ]);

                    totalCommands += Object.keys(commands || {}).length;
                    totalMessages += Number(
                        analytics?.messages || 0
                    );
                })
            );

            res.json({
                totalUsers: Object.keys(users).length,
                totalBots: allBots.length,
                totalCmds: totalCommands,
                totalMessages,
                activeBots: deployments.length,
                storedStats: {
                    totalUsers: Number(stats.totalUsers || 0),
                    totalBots: Number(stats.totalBots || 0),
                    totalCmds: Number(stats.totalCmds || 0),
                    totalMessages: Number(
                        stats.totalMessages || 0
                    )
                },
                recentLogs: logArr
                    .sort(
                        (a, b) =>
                            Number(b.time || 0) -
                            Number(a.time || 0)
                    )
                    .slice(0, 20)
            });
        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    });

    // ===== USER MANAGEMENT =====
    router.get('/users', async (req, res) => {
        try {
            const allUsers = await fbGet('users') || {};

            const result = await Promise.all(
                Object.entries(allUsers).map(
                    async ([uid, user]) => {
                        const bots = toArray(
                            await fbGet(`user_${uid}_bots`)
                        );

                        let totalMessages = 0;
                        const uniqueUsers = new Set();

                        await Promise.all(
                            bots.map(async bot => {
                                const analytics =
                                    await fbGet(
                                        `bot_${bot.id}_analytics`
                                    ) || {};

                                totalMessages += Number(
                                    analytics.messages || 0
                                );

                                getAnalyticsUserIds(
                                    analytics
                                ).forEach(id =>
                                    uniqueUsers.add(id)
                                );
                            })
                        );

                        return {
                            ...user,
                            id: String(user?.id || uid),
                            username: user?.username || '',
                            botCount: bots.length,
                            totalMessages,
                            botUsers: uniqueUsers.size
                        };
                    }
                )
            );

            result.sort(
                (a, b) =>
                    Number(b.created || 0) -
                    Number(a.created || 0)
            );

            res.json(result);
        } catch (error) {
            console.error('[admin/users] Error:', error);
            res.status(500).json({
                error: 'Failed to load users',
                details: error.message
            });
        }
    });

    router.get('/user/:userId', async (req, res) => {
        try {
            const userId = String(req.params.userId);
            const user = await fbGet(`users/${userId}`);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const bots = await fbGet(`user_${userId}_bots`) || [];
            const safeBots = Array.isArray(bots) ? bots : Object.values(bots);

            const botDetails = await Promise.all(
                safeBots.map(async bot => {
                    const analytics =
                        await fbGet(`bot_${bot.id}_analytics`) || {};

                    const uniqueUsers = Array.isArray(analytics.uniqueUsers)
                        ? analytics.uniqueUsers
                        : Object.keys(analytics.uniqueUsers || {});

                    return {
                        ...bot,
                        token: undefined,
                        messages: Number(analytics.messages || 0),
                        uniqueUsers: uniqueUsers.length
                    };
                })
            );

            res.json({
                ...user,
                id: userId,
                bots: botDetails,
                botCount: botDetails.length
            });
        } catch (error) {
            console.error('[admin/user] Error:', error);
            res.status(500).json({
                error: 'Failed to load user',
                details: error.message
            });
        }
    });

    router.post('/user/ban', async (req, res) => {
        try {
            const { targetUserId, reason } = req.body;

            if (!targetUserId) {
                return res.status(400).json({
                    error: 'targetUserId is required'
                });
            }

            await fbUpdate(`users/${targetUserId}`, {
                banned: true,
                banReason: reason || 'Banned by admin'
            });

            await fbPush('activity_logs', {
                time: Date.now(),
                userId: req.adminId,
                action: 'ban_user',
                details: `Banned ${targetUserId}`
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[admin/user/ban] Error:', error);
            res.status(500).json({ error: 'Failed to ban user' });
        }
    });

    router.post('/user/unban', async (req, res) => {
        try {
            const { targetUserId } = req.body;

            if (!targetUserId) {
                return res.status(400).json({
                    error: 'targetUserId is required'
                });
            }

            await fbUpdate(`users/${targetUserId}`, {
                banned: false,
                banReason: null
            });

            await fbPush('activity_logs', {
                time: Date.now(),
                userId: req.adminId,
                action: 'unban_user',
                details: `Unbanned ${targetUserId}`
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[admin/user/unban] Error:', error);
            res.status(500).json({ error: 'Failed to unban user' });
        }
    });

    router.post('/user/delete', async (req, res) => {
        try {
            const { targetUserId } = req.body;

            if (!targetUserId) {
                return res.status(400).json({
                    error: 'targetUserId is required'
                });
            }

            const userBots =
                await fbGet(`user_${targetUserId}_bots`) || [];

            const safeBots = Array.isArray(userBots)
                ? userBots
                : Object.values(userBots);

            let deployments =
                await fbGet('active_deployments') || [];

            if (!Array.isArray(deployments)) {
                deployments = Object.values(deployments);
            }

            for (const bot of safeBots) {
                const deployment = deployments.find(
                    item => String(item.botId) === String(bot.id)
                );

                if (deployment?.token) {
                    try {
                        const telegramBot = new Telegraf(deployment.token);
                        await telegramBot.telegram.deleteWebhook();
                    } catch (error) {
                        console.warn(
                            '[admin/user/delete] Webhook cleanup failed:',
                            error.message
                        );
                    }
                }

                deployments = deployments.filter(
                    item => String(item.botId) !== String(bot.id)
                );

                await Promise.all([
                    fbDelete(`bot_${bot.id}_commands`),
                    fbDelete(`bot_${bot.id}_env`),
                    fbDelete(`bot_${bot.id}_logs`),
                    fbDelete(`bot_${bot.id}_analytics`),
                    fbDelete(`bot_${bot.id}_admins`),
                    fbDelete(`bot_${bot.id}_user_data`),
                    fbDelete(`bot_${bot.id}_broadcasts`)
                ]);
            }

            await Promise.all([
                fbSet('active_deployments', deployments),
                fbDelete(`user_${targetUserId}_bots`),
                fbDelete(`users/${targetUserId}`)
            ]);

            await fbPush('activity_logs', {
                time: Date.now(),
                userId: req.adminId,
                action: 'delete_user',
                details: String(targetUserId)
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[admin/user/delete] Error:', error);
            res.status(500).json({ error: 'Failed to delete user' });
        }
    });

    router.post('/user/set-plan', async (req, res) => {
        try {
            const { targetUserId, plan } = req.body;
            const allowedPlans = ['free', 'premium', 'enterprise'];

            if (!targetUserId || !allowedPlans.includes(plan)) {
                return res.status(400).json({
                    error: 'Valid targetUserId and plan are required'
                });
            }

            await fbUpdate(`users/${targetUserId}`, { plan });
            res.json({ success: true });
        } catch (error) {
            console.error('[admin/user/set-plan] Error:', error);
            res.status(500).json({ error: 'Failed to update plan' });
        }
    });

    router.post('/user/set-role', async (req, res) => {
        try {
            const { targetUserId, role } = req.body;

            if (!targetUserId || !role) {
                return res.status(400).json({
                    error: 'targetUserId and role are required'
                });
            }

            await fbUpdate(`users/${targetUserId}`, { role });
            res.json({ success: true });
        } catch (error) {
            console.error('[admin/user/set-role] Error:', error);
            res.status(500).json({ error: 'Failed to update role' });
        }
    });

    // ===== BOT MANAGEMENT =====
    router.get('/bots', async (req, res) => {
        try {
            const allUsers = await fbGet('users') || {};
            let deployments =
                await fbGet('active_deployments') || [];

            if (!Array.isArray(deployments)) {
                deployments = Object.values(deployments);
            }

            const allBots = [];

            for (const uid of Object.keys(allUsers)) {
                const storedBots =
                    await fbGet(`user_${uid}_bots`) || [];

                const bots = Array.isArray(storedBots)
                    ? storedBots
                    : Object.values(storedBots);

                for (const bot of bots) {
                    const deployment = deployments.find(
                        item => String(item.botId) === String(bot.id)
                    );

                    const analytics =
                        await fbGet(`bot_${bot.id}_analytics`) || {};

                    const uniqueUsers = Array.isArray(
                        analytics.uniqueUsers
                    )
                        ? analytics.uniqueUsers
                        : Object.keys(analytics.uniqueUsers || {});

                    allBots.push({
                        ...bot,
                        token: undefined,
                        ownerUserId: String(uid),
                        ownerName:
                            allUsers[uid]?.name ||
                            allUsers[uid]?.username ||
                            String(uid),
                        status: deployment ? 'Online' : 'Offline',
                        startTime: deployment?.startTime || null,
                        messages: Number(analytics.messages || 0),
                        uniqueUsers: uniqueUsers.length
                    });
                }
            }

            allBots.sort(
                (a, b) =>
                    Number(b.dateCreated || 0) -
                    Number(a.dateCreated || 0)
            );

            res.json(allBots);
        } catch (error) {
            console.error('[admin/bots] Error:', error);
            res.status(500).json({ error: 'Failed to load bots' });
        }
    });
    router.post('/bot/stop', async (req, res) => {
        try {
            const { botId } = req.body;

            if (!botId) {
                return res.status(400).json({
                    error: 'botId is required'
                });
            }

            let deployments =
                await fbGet('active_deployments') || [];

            if (!Array.isArray(deployments)) {
                deployments = Object.values(deployments);
            }

            const deployment = deployments.find(
                item => String(item.botId) === String(botId)
            );

            if (deployment?.token) {
                try {
                    const bot = new Telegraf(deployment.token);
                    await bot.telegram.deleteWebhook();
                } catch (error) {
                    console.warn(
                        '[admin/bot/stop] Webhook cleanup failed:',
                        error.message
                    );
                }
            }

            deployments = deployments.filter(
                item => String(item.botId) !== String(botId)
            );

            await fbSet('active_deployments', deployments);

            await fbPush('activity_logs', {
                time: Date.now(),
                userId: req.adminId,
                action: 'admin_stop_bot',
                details: String(botId)
            });

            res.json({
                success: true,
                status: 'Offline'
            });
        } catch (error) {
            console.error('[admin/bot/stop] Error:', error);
            res.status(500).json({
                error: 'Failed to stop bot'
            });
        }
    });

    router.post('/bot/delete', async (req, res) => {
        try {
            const { ownerUserId, botId } = req.body;

            if (!ownerUserId || !botId) {
                return res.status(400).json({
                    error: 'ownerUserId and botId are required'
                });
            }

            let deployments =
                await fbGet('active_deployments') || [];

            if (!Array.isArray(deployments)) {
                deployments = Object.values(deployments);
            }

            const deployment = deployments.find(
                item => String(item.botId) === String(botId)
            );

            if (deployment?.token) {
                try {
                    const bot = new Telegraf(deployment.token);
                    await bot.telegram.deleteWebhook();
                } catch (error) {
                    console.warn(
                        '[admin/bot/delete] Webhook cleanup failed:',
                        error.message
                    );
                }
            }

            deployments = deployments.filter(
                item => String(item.botId) !== String(botId)
            );

            let ownerBots =
                await fbGet(`user_${ownerUserId}_bots`) || [];

            if (!Array.isArray(ownerBots)) {
                ownerBots = Object.values(ownerBots);
            }

            ownerBots = ownerBots.filter(
                bot => String(bot.id) !== String(botId)
            );

            await Promise.all([
                fbSet('active_deployments', deployments),
                fbSet(`user_${ownerUserId}_bots`, ownerBots),
                fbDelete(`bot_${botId}_commands`),
                fbDelete(`bot_${botId}_env`),
                fbDelete(`bot_${botId}_logs`),
                fbDelete(`bot_${botId}_analytics`),
                fbDelete(`bot_${botId}_admins`),
                fbDelete(`bot_${botId}_user_data`),
                fbDelete(`bot_${botId}_broadcasts`)
            ]);

            await fbPush('activity_logs', {
                time: Date.now(),
                userId: req.adminId,
                action: 'admin_delete_bot',
                details: String(botId)
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[admin/bot/delete] Error:', error);
            res.status(500).json({
                error: 'Failed to delete bot'
            });
        }
    });

    router.get('/bot/logs/:botId', async (req, res) => {
        try {
            const logs =
                await fbGet(`bot_${req.params.botId}_logs`) || [];

            const result = Array.isArray(logs)
                ? logs
                : Object.values(logs);

            result.sort(
                (a, b) =>
                    Number(b.time || 0) -
                    Number(a.time || 0)
            );

            res.json(result);
        } catch (error) {
            console.error('[admin/bot/logs] Error:', error);
            res.status(500).json({
                error: 'Failed to load bot logs'
            });
        }
    });

    router.get('/bot/detail/:botId', async (req, res) => {
        try {
            const botId = String(req.params.botId);
            const allUsers = await fbGet('users') || {};

            let ownerUserId = null;
            let ownerName = null;
            let storedBot = null;

            for (const uid of Object.keys(allUsers)) {
                const rawBots =
                    await fbGet(`user_${uid}_bots`) || [];

                const bots = Array.isArray(rawBots)
                    ? rawBots
                    : Object.values(rawBots);

                const found = bots.find(
                    bot => String(bot.id) === botId
                );

                if (found) {
                    ownerUserId = String(uid);
                    ownerName =
                        allUsers[uid]?.name ||
                        allUsers[uid]?.username ||
                        String(uid);
                    storedBot = found;
                    break;
                }
            }

            if (!storedBot) {
                return res.status(404).json({
                    error: 'Bot not found'
                });
            }

            let deployments =
                await fbGet('active_deployments') || [];

            if (!Array.isArray(deployments)) {
                deployments = Object.values(deployments);
            }

            const deployment = deployments.find(
                item => String(item.botId) === botId
            );

            const [
                commands,
                rawLogs,
                analytics,
                rawAdmins,
                userData,
                rawBroadcasts
            ] = await Promise.all([
                fbGet(`bot_${botId}_commands`),
                fbGet(`bot_${botId}_logs`),
                fbGet(`bot_${botId}_analytics`),
                fbGet(`bot_${botId}_admins`),
                fbGet(`bot_${botId}_user_data`),
                fbGet(`bot_${botId}_broadcasts`)
            ]);

            const logs = Array.isArray(rawLogs)
                ? rawLogs
                : Object.values(rawLogs || {});

            const uniqueUsers = Array.isArray(
                analytics?.uniqueUsers
            )
                ? analytics.uniqueUsers
                : Object.keys(analytics?.uniqueUsers || {});

            const admins = Array.isArray(rawAdmins)
                ? rawAdmins
                : Object.values(rawAdmins || {});

            const broadcasts = Array.isArray(rawBroadcasts)
                ? rawBroadcasts
                : Object.values(rawBroadcasts || {});

            res.json({
                botId,
                name: storedBot.name || 'Bot',
                username: storedBot.username || '',
                ownerUserId,
                ownerName,
                status: deployment ? 'Online' : 'Offline',
                startTime: deployment?.startTime || null,
                commandCount: Object.keys(commands || {}).length,
                recentLogs: logs
                    .sort(
                        (a, b) =>
                            Number(b.time || 0) -
                            Number(a.time || 0)
                    )
                    .slice(0, 50),
                messages: Number(analytics?.messages || 0),
                uniqueUsers: uniqueUsers.length,
                admins: admins.slice(0, 10),
                userData: userData || {},
                broadcasts: broadcasts
                    .sort(
                        (a, b) =>
                            Number(b.time || 0) -
                            Number(a.time || 0)
                    )
                    .slice(0, 50)
            });
        } catch (error) {
            console.error('[admin/bot/detail] Error:', error);
            res.status(500).json({
                error: 'Failed to load bot details'
            });
        }
    });

    router.post('/bot/toggle', async (req, res) => {
        try {
            const { botId, action } = req.body;

            if (!botId || !action) {
                return res.status(400).json({
                    error: 'botId and action are required'
                });
            }

            if (action !== 'stop') {
                return res.status(400).json({
                    error: 'Only stop is supported in the admin panel'
                });
            }

            let deployments =
                await fbGet('active_deployments') || [];

            if (!Array.isArray(deployments)) {
                deployments = Object.values(deployments);
            }

            const deployment = deployments.find(
                item => String(item.botId) === String(botId)
            );

            if (deployment?.token) {
                try {
                    const bot = new Telegraf(deployment.token);
                    await bot.telegram.deleteWebhook();
                } catch (error) {
                    console.warn(
                        '[admin/bot/toggle] Webhook cleanup failed:',
                        error.message
                    );
                }
            }

            deployments = deployments.filter(
                item => String(item.botId) !== String(botId)
            );

            await fbSet('active_deployments', deployments);

            await fbPush('activity_logs', {
                time: Date.now(),
                userId: req.adminId,
                action: 'admin_stop_bot',
                details: String(botId)
            });

            res.json({
                success:true,
                status: 'Offline'
            });
        } catch (error) {
            console.error('[admin/bot/stop] Error:', error);
            res.status(500).json({ error: 'Failed to stop bot' });
        }
    });
            // ===== BOT ADMINS AND PERMISSIONS =====

    router.get('/bot/admins/:botId', async (req, res) => {
        try {
            const raw =
                await fbGet(`bot_${req.params.botId}_admins`) || [];

            const admins = Array.isArray(raw)
                ? raw
                : Object.values(raw);

            res.json(admins.slice(0, 10));
        } catch (error) {
            res.status(500).json({
                error: 'Failed to load bot admins'
            });
        }
    });

    router.post('/bot/admins/:botId', async (req, res) => {
        try {
            const { admins } = req.body;

            if (!Array.isArray(admins)) {
                return res.status(400).json({
                    error: 'admins must be an array'
                });
            }

            const normalized = [];
            const seen = new Set();

            for (const entry of admins) {
                const value = String(
                    typeof entry === 'object'
                        ? entry.value || entry.id || entry.username || ''
                        : entry
                )
                    .trim()
                    .replace(/^@/, '');

                if (!value) continue;

                const key = value.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);

                normalized.push({
                    value,
                    type: /^\d+$/.test(value) ? 'id' : 'username'
                });

                if (normalized.length === 10) break;
            }

            await fbSet(
                `bot_${req.params.botId}_admins`,
                normalized
            );

            await fbPush('activity_logs', {
                time: Date.now(),
                userId: req.adminId,
                action: 'update_bot_admins',
                details: `${req.params.botId}: ${normalized.length}`
            });

            res.json({
                success: true,
                admins: normalized
            });
        } catch (error) {
            console.error('[admin/bot/admins] Error:', error);
            res.status(500).json({
                error: 'Failed to save bot admins'
            });
        }
    });

    router.get('/bot/user-data/:botId', async (req, res) => {
        try {
            const raw =
                await fbGet(`bot_${req.params.botId}_user_data`) || {};

            const users = Array.isArray(raw)
                ? raw
                : Object.entries(raw).map(([id, data]) => ({
                    id,
                    ...(data || {})
                }));

            users.sort(
                (a, b) =>
                    Number(b.lastSeen || b.updatedAt || 0) -
                    Number(a.lastSeen || a.updatedAt || 0)
            );

            res.json(users);
        } catch (error) {
            res.status(500).json({
                error: 'Failed to load bot user data'
            });
        }
    });
router.post('/broadcast', async (req, res) => {
    try {
        const {
            message,
            target = 'all',
            specificId,
            parseMode
        } = req.body;

        if (!message) {
            return res.status(400).json({
                error: 'Message is required'
            });
        }

        const startedAt = Date.now();
        const broadcastId = `broadcast_${startedAt}`;
        const telegramBot = new Telegraf(BOT_TOKEN);

        if (target === 'group') {
            if (!specificId) {
                return res.status(400).json({
                    error: 'Group ID is required'
                });
            }

            await telegramBot.telegram.sendMessage(
                specificId,
                message,
                { parse_mode: parseMode || 'HTML' }
            );

            const result = {
                id: broadcastId,
                time: startedAt,
                finishedAt: Date.now(),
                message,
                target: 'group',
                total: 1,
                processed: 1,
                sent: 1,
                errors: 0,
                failed: 0,
                progress: 100,
                speed: 1,
                status: 'completed',
                sender: req.adminId
            };

            await saveBroadcastHistory(result);
            return res.json({ success: true, ...result });
        }

        const allUsers = await fbGet('users') || {};
        let targets = Object.values(allUsers);

        if (target === 'free') {
            targets = targets.filter(
                user => (user.plan || 'free') === 'free'
            );
        } else if (target === 'premium') {
            targets = targets.filter(
                user =>
                    user.plan === 'premium' ||
                    user.plan === 'enterprise'
            );
        } else if (target === 'specific') {
            targets = targets.filter(
                user => String(user.id) === String(specificId)
            );
        }

        targets = targets.filter(user => !user.banned);

        let sent = 0;
        let failed = 0;

        for (const user of targets) {
            try {
                await telegramBot.telegram.sendMessage(
                    user.id,
                    message,
                    { parse_mode: parseMode || 'HTML' }
                );
                sent++;
            } catch (error) {
                failed++;
            }

            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const finishedAt = Date.now();
        const duration = Math.max(
            (finishedAt - startedAt) / 1000,
            0.001
        );

        const result = {
            id: broadcastId,
            time: startedAt,
            finishedAt,
            message,
            target,
            total: targets.length,
            processed: sent + failed,
            sent,
            errors: failed,
            failed,
            progress: 100,
            speed: Number((sent / duration).toFixed(2)),
            status: 'completed',
            sender: req.adminId
        };

        await saveBroadcastHistory(result);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[admin/broadcast] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
router.get('/bot/broadcasts/:botId', async (req, res) => {
    try {
        const botId = sanitizeIdentifier(req.params.botId);

        const [globalHistory, botHistory] = await Promise.all([
            fbGet('broadcast_history'),
            fbGet(`bot_${botId}_broadcasts`)
        ]);

        const globalItems = toArray(globalHistory).filter(item =>
            String(item.botId || '') === botId ||
            String(item.target || '') === `bot:${botId}`
        );

        const result = [
            ...globalItems,
            ...toArray(botHistory)
        ];

        const unique = Array.from(
            new Map(
                result.map(item => [
                    item.id || `${item.time}-${item.message}`,
                    item
                ])
            ).values()
        );

        unique.sort(
            (a, b) =>
                Number(b.time || b.createdAt || 0) -
                Number(a.time || a.createdAt || 0)
        );

        res.json(unique.slice(0, 100));
    } catch (error) {
        res.status(500).json({
            error: 'Failed to load broadcasts'
        });
    }
});

    // ===== BOT BROADCAST =====

    router.post('/bot/broadcast', async (req, res) => {
        try {
            const {
                botId,
                message,
                parseMode,
                photoUrl,
                btnText,
                btnUrl
            } = req.body;

            if (!botId || !message) {
                return res.status(400).json({
                    error: 'botId and message are required'
                });
            }

            let deployments =
                await fbGet('active_deployments') || [];

            if (!Array.isArray(deployments)) {
                deployments = Object.values(deployments);
            }

            let token = deployments.find(
                item => String(item.botId) === String(botId)
            )?.token;

            if (!token) {
                const allUsers = await fbGet('users') || {};

                for (const uid of Object.keys(allUsers)) {
                    const rawBots =
                        await fbGet(`user_${uid}_bots`) || [];

                    const bots = Array.isArray(rawBots)
                        ? rawBots
                        : Object.values(rawBots);

                    const found = bots.find(
                        bot => String(bot.id) === String(botId)
                    );

                    if (found?.token) {
                        token = found.token;
                        break;
                    }
                }
            }

            if (!token) {
                return res.status(404).json({
                    error: 'Bot or bot token not found'
                });
            }

            const analytics =
                await fbGet(`bot_${botId}_analytics`) || {};

            const userIds = Array.isArray(
                analytics.uniqueUsers
            )
                ? analytics.uniqueUsers
                : Object.keys(analytics.uniqueUsers || {});

            if (!userIds.length) {
                return res.status(400).json({
                    error: 'No users have interacted with this bot'
                });
            }

            const broadcastId = `broadcast_${Date.now()}`;
            const startedAt = Date.now();
            const telegramBot = new Telegraf(token);

            let sent = 0;
            let errors = 0;

            const initialRecord = {
                id: broadcastId,
                botId: String(botId),
                message,
                target: `bot:${botId}`,
                total: userIds.length,
                processed: 0,
                sent: 0,
                errors: 0,
                failed: 0,
                progress: 0,
                speed: 0,
                status: 'sending',
                time: startedAt,
                sender: req.adminId
            };

            await fbSet(
                `bot_${botId}_broadcasts/${broadcastId}`,
                initialRecord
            );

            for (const uid of userIds) {
                try {
                    const replyMarkup =
                        btnText && btnUrl
                            ? {
                                inline_keyboard: [[{
                                    text: btnText,
                                    url: btnUrl
                                }]]
                            }
                            : undefined;

                    if (photoUrl) {
                        await telegramBot.telegram.sendPhoto(
                            uid,
                            photoUrl,
                            {
                                caption: message,
                                parse_mode: parseMode || 'HTML',
                                reply_markup: replyMarkup
                            }
                        );
                    } else {
                        await telegramBot.telegram.sendMessage(
                            uid,
                            message,
                            {
                                parse_mode: parseMode || 'HTML',
                                reply_markup: replyMarkup
                            }
                        );
                    }

                    sent++;
                } catch (error) {
                    errors++;
                }

                const processed = sent + errors;
                const duration = Math.max(
                    (Date.now() - startedAt) / 1000,
                    0.001
                );

                await fbUpdate(
                    `bot_${botId}_broadcasts/${broadcastId}`,
                    {
                        processed,
                        sent,
                        errors,
                        failed: errors,
                        progress: Math.round(
                            processed / userIds.length * 100
                        ),
                        speed: Number(
                            (sent / duration).toFixed(2)
                        )
                    }
                );

                await new Promise(resolve =>
                    setTimeout(resolve, 50)
                );
            }

            const finishedAt = Date.now();
            const duration = Math.max(
                (finishedAt - startedAt) / 1000,
                0.001
            );

            const result = {
                ...initialRecord,
                processed: sent + errors,
                sent,
                errors,
                failed: errors,
                progress: 100,
                speed: Number((sent / duration).toFixed(2)),
                status: 'completed',
                finishedAt
            };

            await Promise.all([
                fbSet(
                    `bot_${botId}_broadcasts/${broadcastId}`,
                    result
                ),
                fbPush('broadcast_history', result)
            ]);

            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            console.error('[admin/bot/broadcast] Error:', error);
            res.status(500).json({
                error: 'Failed to send broadcast'
            });
        }
    });

    router.get('/broadcast-history', async (req, res) => {
        try {
            const history = await fbGet('broadcast_history') || {};
            const items = toArray(history)
                .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
                .slice(0, 100)
                .map(item => ({
                    ...item,
                    errors: Number(item.errors ?? item.failed ?? 0),
                    failed: Number(item.failed ?? item.errors ?? 0),
                    progress: Number(item.progress ?? 100),
                    speed: Number(item.speed || 0),
                    status: item.status || 'completed'
                }));

            res.json(items);
        } catch (error) {
            console.error('[admin/broadcast-history] Error:', error);
            res.status(500).json({
                error: 'Failed to load broadcast history'
            });
        }
    });

    // ===== ACTIVITY LOGS =====
    router.get('/logs', async (req, res) => {
        try {
            const logs = await fbGet('activity_logs') || {};
            res.json(
                toArray(logs)
                    .sort(
                        (a, b) =>
                            Number(b.time || 0) - Number(a.time || 0)
                    )
                    .slice(0, 200)
            );
        } catch (error) {
            res.status(500).json({
                error: 'Failed to load activity logs'
            });
        }
    });

    router.delete('/logs', async (req, res) => {
        await fbDelete('activity_logs');
        res.json({ success: true });
    });

    // ===== SUBSCRIPTION PLANS =====
    const DEFAULT_PLANS = {
        free: {
            name: 'Free',
            price: 0,
            maxBots: 3,
            maxCmds: 20,
            description: 'Basic plan for beginners'
        },
        premium: {
            name: 'Premium',
            price: 9.99,
            maxBots: 20,
            maxCmds: 200,
            description: 'For serious developers'
        },
        enterprise: {
            name: 'Enterprise',
            price: 49.99,
            maxBots: 100,
            maxCmds: 1000,
            description: 'For businesses and teams'
        }
    };

    router.get('/plans', async (req, res) => {
        res.json(await fbGet('plans') || DEFAULT_PLANS);
    });

    router.post('/plans', async (req, res) => {
        const { planId, planData } = req.body;

        if (!planId || !planData) {
            return res.status(400).json({
                error: 'planId and planData are required'
            });
        }

        const plans = await fbGet('plans') || DEFAULT_PLANS;
        plans[planId] = planData;
        await fbSet('plans', plans);

        res.json({ success: true });
    });

    // ===== SYSTEM =====
    router.get('/system-info', async (req, res) => {
        const stats = await fbGet('global_stats') || {};
        const users = await fbGet('users') || {};
        const deployments = toArray(
            await fbGet('active_deployments') || []
        );

        let totalBots = 0;

        for (const uid of Object.keys(users)) {
            totalBots += toArray(
                await fbGet(`user_${uid}_bots`) || []
            ).length;
        }

        res.json({
            platform: 'Vercel Serverless',
            region: process.env.VERCEL_REGION || 'auto',
            nodeVersion: process.version,
            activeBots: deployments.length,
            totalMessages: Number(stats.totalMessages || 0),
            totalBots,
            totalUsers: Object.keys(users).length,
            uptime: process.uptime()
        });
    });

    router.post('/reset-stats', async (req, res) => {
        await fbSet('global_stats', {
            totalBots: 0,
            totalUsers: 0,
            totalCmds: 0,
            totalMessages: 0
        });

        res.json({ success: true });
    });

    // ===== MAINTENANCE =====
    router.get('/maintenance', async (req, res) => {
        const settings = await fbGet('platform_settings') || {};
        res.json({ maintenance: Boolean(settings.maintenance) });
    });

    router.post('/maintenance', async (req, res) => {
        const settings = await fbGet('platform_settings') || {};
        settings.maintenance = Boolean(req.body.enabled);

        await fbSet('platform_settings', settings);
        await logAdmin(
            req,
            settings.maintenance
                ? 'maintenance_on'
                : 'maintenance_off'
        );

        res.json({
            success: true,
            maintenance: settings.maintenance
        });
    });

    // ===== PLATFORM SETTINGS =====
    router.get('/platform-settings', async (req, res) => {
        const settings = await fbGet('platform_settings') || {};

        res.json({
            maintenance: Boolean(settings.maintenance),
            maxBotsFree: Number(settings.maxBotsFree || 3),
            maxCmdsFree: Number(settings.maxCmdsFree || 20),
            maxBotsPrem: Number(settings.maxBotsPrem || 20),
            globalAdmins: normalizeAdminEntries(
                settings.globalAdmins || ADMIN_IDS
            )
        });
    });

    router.post('/platform-settings', async (req, res) => {
        const {
            maxBotsFree,
            maxCmdsFree,
            maxBotsPrem,
            globalAdmins
        } = req.body;

        const settings = await fbGet('platform_settings') || {};

        if (maxBotsFree !== undefined) {
            settings.maxBotsFree =
                Number.parseInt(maxBotsFree, 10) || 3;
        }

        if (maxCmdsFree !== undefined) {
            settings.maxCmdsFree =
                Number.parseInt(maxCmdsFree, 10) || 20;
        }

        if (maxBotsPrem !== undefined) {
            settings.maxBotsPrem =
                Number.parseInt(maxBotsPrem, 10) || 20;
        }

        if (globalAdmins !== undefined) {
            const normalized = normalizeAdminEntries(globalAdmins);

            if (normalized.length > 10) {
                return res.status(400).json({
                    error: 'A maximum of 10 global admins is allowed'
                });
            }

            settings.globalAdmins = normalized;
        }

        await fbSet('platform_settings', settings);
        res.json({ success: true, settings });
    });

    // ===== ANNOUNCEMENT =====
    router.post('/announce', async (req, res) => {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({
                error: 'Message is required'
            });
        }

        const telegramBot = new Telegraf(BOT_TOKEN);
        const users = Object.values(
            await fbGet('users') || {}
        ).filter(user => !user.banned);

        let sent = 0;
        let failed = 0;

        for (const user of users) {
            try {
                await telegramBot.telegram.sendMessage(
                    user.id,
                    `System Announcement\n\n${message}`
                );
                sent++;
            } catch (error) {
                failed++;
            }

            await delay(50);
        }

        await logAdmin(
            req,
            'announcement',
            `Sent ${sent}; failed ${failed}`
        );

        res.json({ success: true, sent, failed });
    });

    // ===== COUPONS =====
    router.get('/coupons', async (req, res) => {
        res.json(toArray(await fbGet('coupons') || {}));
    });

    router.post('/coupons', async (req, res) => {
        const { code, plan, maxUses } = req.body;

        if (!code) {
            return res.status(400).json({
                error: 'Code is required'
            });
        }

        const coupons = toArray(
            await fbGet('coupons') || []
        );

        const normalizedCode = String(code).trim().toUpperCase();

        if (coupons.some(item => item.code === normalizedCode)) {
            return res.status(409).json({
                error: 'Code already exists'
            });
        }

        coupons.push({
            code: normalizedCode,
            plan: plan || 'premium',
            maxUses: Number.parseInt(maxUses, 10) || 100,
            used: 0,
            createdAt: Date.now()
        });

        await fbSet('coupons', coupons);
        res.json({ success: true });
    });

    router.post('/coupon/delete', async (req, res) => {
        const code = String(req.body.code || '').toUpperCase();

        const coupons = toArray(
            await fbGet('coupons') || []
        ).filter(item => item.code !== code);

        await fbSet('coupons', coupons);
        res.json({ success: true });
    });

    // ===== BOT HEALTH =====
    router.get('/bot-health', async (req, res) => {
        const users = await fbGet('users') || {};
        const results = [];

        for (const uid of Object.keys(users)) {
            const bots = toArray(
                await fbGet(`user_${uid}_bots`) || []
            );

            for (const bot of bots) {
                if (!bot.token) {
                    results.push({
                        name: bot.name,
                        username: bot.username || '',
                        botId: String(bot.id),
                        healthy: false
                    });
                    continue;
                }

                try {
                    const telegramBot = new Telegraf(bot.token);
                    const details = await telegramBot.telegram.getMe();

                    results.push({
                        name: bot.name,
                        username: details.username || '',
                        botId: String(bot.id),
                        healthy: true
                    });
                } catch (error) {
                    results.push({
                        name: bot.name,
                        username: bot.username || '',
                        botId: String(bot.id),
                        healthy: false,
                        error: error.message
                    });
                }
            }
        }

        res.json({ results });
    });

    router.post('/validate-token', async (req, res) => {
        const { token } = req.body;

        if (!token) {
            return res.json({ valid: false });
        }

        try {
            const telegramBot = new Telegraf(token);
            const details = await telegramBot.telegram.getMe();

            res.json({
                valid: true,
                name: details.first_name,
                username: details.username,
                id: details.id
            });
        } catch (error) {
            res.json({
                valid: false,
                error: error.message
            });
        }
    });

    // ===== USER NOTES =====
    router.post('/user-note', async (req, res) => {
        const { targetUserId, text } = req.body;

        if (!targetUserId || !text) {
            return res.status(400).json({
                error: 'targetUserId and text are required'
            });
        }

        await fbPush(`user_${targetUserId}_notes`, {
            time: Date.now(),
            text,
            adminId: req.adminId
        });

        res.json({ success: true });
    });

    router.get('/user-notes/:userId', async (req, res) => {
        const notes = toArray(
            await fbGet(`user_${req.params.userId}_notes`) || {}
        );

        notes.sort(
            (a, b) => Number(b.time || 0) - Number(a.time || 0)
        );

        res.json(notes);
    });

    // ===== BACKUP AND EXPORT =====
    router.get('/full-backup', async (req, res) => {
        const [users, deployments, stats, logs, plans] =
            await Promise.all([
                fbGet('users'),
                fbGet('active_deployments'),
                fbGet('global_stats'),
                fbGet('activity_logs'),
                fbGet('plans')
            ]);

        res.json({
            exportDate: new Date().toISOString(),
            users: users || {},
            active_deployments: deployments || [],
            global_stats: stats || {},
            recent_activity_logs: toArray(logs || {})
                .sort(
                    (a, b) =>
                        Number(b.time || 0) - Number(a.time || 0)
                )
                .slice(0, 100),
            plans: plans || {}
        });
    });

    router.get('/bot/commands/:botId', async (req, res) => {
        res.json(
            await fbGet(
                `bot_${sanitizeIdentifier(req.params.botId)}_commands`
            ) || {}
        );
    });

    router.get('/export-users', async (req, res) => {
        res.json(Object.values(await fbGet('users') || {}));
    });

    // ===== SCHEDULED BROADCASTS =====
    router.get('/scheduled-broadcasts', async (req, res) => {
        res.json(
            toArray(await fbGet('scheduled_broadcasts') || [])
        );
    });

    router.post('/scheduled-broadcasts', async (req, res) => {
        const {
            message,
            scheduledTime,
            target,
            parseMode
        } = req.body;

        const timestamp = new Date(scheduledTime).getTime();

        if (!message || !Number.isFinite(timestamp)) {
            return res.status(400).json({
                error: 'Valid message and scheduledTime are required'
            });
        }

        const item = {
            id: Date.now(),
            message,
            scheduledTime: timestamp,
            target: target || 'all',
            parseMode: parseMode || 'HTML',
            createdAt: Date.now(),
            status: 'pending',
            sentCount: 0,
            failedCount: 0,
            progress: 0,
            speed: 0
        };

        const scheduled = toArray(
            await fbGet('scheduled_broadcasts') || []
        );

        scheduled.push(item);
        await fbSet('scheduled_broadcasts', scheduled);

        res.json({ success: true, item });
    });

    router.delete('/scheduled-broadcasts/:id', async (req, res) => {
        const id = Number.parseInt(req.params.id, 10);

        const scheduled = toArray(
            await fbGet('scheduled_broadcasts') || []
        ).filter(item => Number(item.id) !== id);

        await fbSet('scheduled_broadcasts', scheduled);
        res.json({ success: true });
    });

    router.post('/process-scheduled', async (req, res) => {
        const scheduled = toArray(
            await fbGet('scheduled_broadcasts') || []
        );

        const now = Date.now();
        const due = scheduled.filter(
            item =>
                item.status === 'pending' &&
                Number(item.scheduledTime) <= now
        );

        if (!due.length) {
            return res.json({ processed: 0, sent: 0, failed: 0 });
        }

        const users = Object.values(
            await fbGet('users') || {}
        );

        const telegramBot = new Telegraf(BOT_TOKEN);
        let totalSent = 0;
        let totalFailed = 0;

        for (const item of due) {
            const startedAt = Date.now();
            let targets = users.filter(user => !user.banned);

            if (item.target === 'premium') {
                targets = targets.filter(
                    user =>
                        user.plan === 'premium' ||
                        user.plan === 'enterprise'
                );
            } else if (item.target === 'free') {
                targets = targets.filter(
                    user => !user.plan || user.plan === 'free'
                );
            }

            let itemSent = 0;
            let itemFailed = 0;

            for (const user of targets) {
                try {
                    await telegramBot.telegram.sendMessage(
                        user.id,
                        item.message,
                        { parse_mode: item.parseMode || 'HTML' }
                    );
                    itemSent++;
                    totalSent++;
                } catch (error) {
                    itemFailed++;
                    totalFailed++;
                }

                await delay(50);
            }

            const finishedAt = Date.now();
            const duration = Math.max(
                (finishedAt - startedAt) / 1000,
                0.001
            );

            item.status = 'sent';
            item.sentAt = finishedAt;
            item.sentCount = itemSent;
            item.failedCount = itemFailed;
            item.progress = 100;
            item.speed = Number((itemSent / duration).toFixed(2));

            await fbPush('broadcast_history', {
                id: `scheduled_${item.id}`,
                time: startedAt,
                finishedAt,
                target: `scheduled:${item.target}`,
                message: item.message,
                total: targets.length,
                processed: itemSent + itemFailed,
                sent: itemSent,
                errors: itemFailed,
                failed: itemFailed,
                progress: 100,
                speed: item.speed,
                status: 'completed',
                sender: req.adminId
            });
        }

        await fbSet('scheduled_broadcasts', scheduled);

        res.json({
            processed: due.length,
            sent: totalSent,
            failed: totalFailed
        });
    });

    // ===== ADMIN TEMPLATE MANAGEMENT =====
    router.get('/bot-templates', async (req, res) => {
        res.json(
            toArray(await fbGet('admin_bot_templates') || {})
        );
    });

    router.post('/bot-templates', async (req, res) => {
        const {
            name,
            description,
            category,
            commands,
            envVars,
            permissions
        } = req.body;

        if (!name || !Array.isArray(commands)) {
            return res.status(400).json({
                error: 'name and commands are required'
            });
        }

        const id = `tpl_${Date.now()}`;

        const template = {
            id,
            name,
            description: description || '',
            category: category || 'Single Commands',
            commands,
            envVars: Array.isArray(envVars) ? envVars : [],
            permissions: permissions || {
                share: true,
                clone: true,
                transfer: true,
                download: true
            },
            createdAt: Date.now(),
            featured: false
        };

        const templates = toArray(
            await fbGet('admin_bot_templates') || []
        );

        templates.push(template);
        await fbSet('admin_bot_templates', templates);

        res.json({ success: true, id, template });
    });

    router.put('/bot-templates/:id', async (req, res) => {
        const id = sanitizeIdentifier(req.params.id);
        const templates = toArray(
            await fbGet('admin_bot_templates') || []
        );

        const index = templates.findIndex(
            item => String(item.id) === id
        );

        if (index === -1) {
            return res.status(404).json({
                error: 'Template not found'
            });
        }

        const {
            adminId: ignoredAdminId,
            ...updates
        } = req.body;

        templates[index] = {
            ...templates[index],
            ...updates,
            id
        };

        await fbSet('admin_bot_templates', templates);
        res.json({ success: true, template: templates[index] });
    });

    router.delete('/bot-templates/:id', async (req, res) => {
        const id = sanitizeIdentifier(req.params.id);

        const templates = toArray(
            await fbGet('admin_bot_templates') || []
        ).filter(item => String(item.id) !== id);

        await fbSet('admin_bot_templates', templates);
        res.json({ success: true });
    });

    // ===== TEMPLATE CATEGORIES =====
    const DEFAULT_CATEGORIES = [
        'Full Project',
        'Single Commands',
        'Entertainment',
        'Business',
        'E-Commerce',
        'Communication',
        'Administration'
    ];

    router.get('/template-categories', async (req, res) => {
        res.json(
            toArray(
                await fbGet('template_categories') ||
                DEFAULT_CATEGORIES
            )
        );
    });

    router.post('/template-categories', async (req, res) => {
        const name = String(req.body.name || '').trim();

        if (!name) {
            return res.status(400).json({
                error: 'Name is required'
            });
        }

        const categories = toArray(
            await fbGet('template_categories') ||
            DEFAULT_CATEGORIES
        );

        if (!categories.includes(name)) {
            categories.push(name);
        }

        await fbSet('template_categories', categories);

        res.json({
            success: true,
            categories
        });
    });

    router.delete('/template-categories/:name', async (req, res) => {
        const name = req.params.name;

        const categories = toArray(
            await fbGet('template_categories') || []
        ).filter(category => category !== name);

        await fbSet('template_categories', categories);
        res.json({ success: true });
    });

    return router;
};


