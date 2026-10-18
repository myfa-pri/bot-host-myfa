import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { users, ownedBots, botCommands, messageEvents, activityLogs } from '../schema.js';
import { upsertUser } from '../lib/users.js';
import { requireUser } from '../lib/access.js';
import { requireOwnedBot } from '../lib/bots.js';

function cleanPath(path) {
  return '/' + String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

export default async function (input, ctx) {
  const path = cleanPath(input?.path);
  const method = String(input?.method || 'GET').toUpperCase();
  const query = input?.query || {};
  const body = input?.body || {};

  const user = await requireUser(ctx);
  const userId = Number(user.tgId);

  if (path === '/register-user') {
    const current = await upsertUser(ctx.initData.user);
    return {
      success: true,
      user: {
        id: current.tgId,
        name: current.firstName,
        username: current.username,
        plan: current.plan,
        gems: current.gems,
        coins: current.coins,
      },
    };
  }

  if (path === '/global-stats') {
    return {
      totalUsers: await db.$count(users),
      totalBots: await db.$count(ownedBots),
      totalCommands: await db.$count(botCommands),
      totalMessages: await db.$count(messageEvents),
    };
  }

  if (path === '/dashboard-stats') {
    const bots = await db.select().from(ownedBots).where(eq(ownedBots.ownerTgId, userId)).all();
    let commands = 0;
    for (const bot of bots) {
      commands += await db.$count(botCommands, eq(botCommands.telegramBotId, bot.telegramBotId));
    }
    return {
      users: await db.$count(users),
      bots: bots.length,
      commands,
      messages: await db.$count(messageEvents, eq(messageEvents.userTgId, userId)),
      gems: user.gems,
      coins: user.coins,
      xp: user.xp,
      level: user.level,
    };
  }

  if (path === '/bots' || path === '/my-bots' || path === '/get-bots') {
    return await db.select().from(ownedBots)
      .where(eq(ownedBots.ownerTgId, userId)).all();
  }

  if (path === '/bot-analytics') {
    const botId = String(query.botId || body.botId || '');
    await requireOwnedBot(botId, userId);
    return {
      messages: await db.$count(messageEvents),
      commands: await db.$count(botCommands, eq(botCommands.telegramBotId, botId)),
      logs: await db.$count(activityLogs),
    };
  }

  if (path === '/bot-commands' || path === '/commands' || path === '/get-commands') {
    const botId = String(query.botId || body.botId || '');
    await requireOwnedBot(botId, userId);
    return await db.select().from(botCommands)
      .where(eq(botCommands.telegramBotId, botId)).all();
  }

  if (path === '/save-command' && method === 'POST') {
    const botId = String(body.botId || '');
    const command = String(body.command || '').replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
    if (!botId || !command) throw new Error('botId and command are required');
    await requireOwnedBot(botId, userId);

    const existing = await db.select().from(botCommands)
      .where(and(eq(botCommands.telegramBotId, botId), eq(botCommands.command, command))).get();

    const values = {
      answer: String(body.answer || '').slice(0, 4000),
      help: String(body.help || '').slice(0, 200),
      aliases: String(body.aliases || '').slice(0, 500),
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(botCommands).set(values).where(eq(botCommands.id, existing.id)).run();
    } else {
      await db.insert(botCommands).values({ telegramBotId: botId, command, ...values }).run();
    }
    return { success: true, command };
  }

  if (path === '/delete-command' && method === 'POST') {
    const botId = String(body.botId || '');
    const commandId = Number(body.commandId);
    await requireOwnedBot(botId, userId);
    await db.delete(botCommands)
      .where(and(eq(botCommands.id, commandId), eq(botCommands.telegramBotId, botId))).run();
    return { success: true };
  }

  if (path === '/refer-stats' || path === '/refer-leaderboard' || path === '/refer-logs') {
    // Referral data is intentionally not fabricated during migration.
    // The dedicated referral tables will be added in the next schema migration.
    return path === '/refer-leaderboard' || path === '/refer-logs' ? [] : { refs: 0, points: 0 };
  }

  if (path === '/health' || path === '/status') {
    return { ok: true, platform: 'telegram-serverless', userId };
  }

  throw new Error('Unsupported legacy API route: ' + path);
}
