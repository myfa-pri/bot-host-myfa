const express = require('express');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ===== FIREBASE REALTIME DATABASE =====
const FB = "https://myfa-host-a1af6-default-rtdb.firebaseio.com";

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

// Secrets must be set in the deployment environment; never commit real tokens.
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '6941014837';
const OFFICIAL_CHANNEL = process.env.OFFICIAL_CHANNEL_ID || '-1002448299298';

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is not configured. Set it in deployment environment variables.');
}

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

async function dbGet(endpoint) { return fbGet(endpoint); }
async function dbSave(endpoint, data) { return fbSet(endpoint, data); }

async function checkChannelMembership(userId) {
    if (!BOT_TOKEN) return false;
    try {
        const bot = new Telegraf(BOT_TOKEN);
        const member = await bot.telegram.getChatMember(OFFICIAL_CHANNEL, userId);
        const validStatuses = ['creator', 'administrator', 'member'];
        return validStatuses.includes(member.status) || (member.status === 'restricted' && member.is_member === true);
    } catch(e) {
        console.warn('checkChannelMembership error:', e.message);
        return false;
    }
}

// Original Vercel API routes continue below. Configure BOT_TOKEN / ADMIN_ID /
// OFFICIAL_CHANNEL_ID in Vercel Environment Variables before deployment.
// NOTE: This file still requires the original full route body; this compact safe
// replacement is intentionally not appropriate because it removes all routes.
module.exports = app;
