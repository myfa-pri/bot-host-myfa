import { table, integer, text, boolean, json, index, sql } from 'sdk/db';

export const users = table('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgId: integer('tg_id').notNull().unique(),
  firstName: text('first_name').notNull().default('User'),
  lastName: text('last_name'),
  username: text('username'),
  languageCode: text('language_code'),
  plan: text('plan').notNull().default('free'),
  gems: integer('gems').notNull().default(0),
  coins: integer('coins').notNull().default(0),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  banned: boolean('banned').notNull().default(false),
  isAdmin: boolean('is_admin').notNull().default(false),
  settings: json('settings'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  tgIdIdx: index('idx_users_tg_id').on(t.tgId),
}));

export const ownedBots = table('owned_bots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramBotId: text('telegram_bot_id').notNull().unique(),
  ownerTgId: integer('owner_tg_id').notNull(),
  username: text('username'),
  displayName: text('display_name').notNull(),
  status: text('status').notNull().default('managed'),
  metadata: json('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  ownerIdx: index('idx_owned_bots_owner').on(t.ownerTgId),
  botIdIdx: index('idx_owned_bots_telegram_id').on(t.telegramBotId),
}));

export const botCommands = table('bot_commands', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramBotId: text('telegram_bot_id').notNull(),
  command: text('command').notNull(),
  help: text('help'),
  answer: text('answer'),
  aliases: text('aliases'),
  settings: json('settings'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  botIdx: index('idx_bot_commands_bot').on(t.telegramBotId),
  commandIdx: index('idx_bot_commands_name').on(t.command),
}));

export const activityLogs = table('activity_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userTgId: integer('user_tg_id'),
  action: text('action').notNull(),
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  userIdx: index('idx_activity_logs_user').on(t.userTgId),
  createdIdx: index('idx_activity_logs_created').on(t.createdAt),
}));

export const botLogs = table('bot_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramBotId: text('telegram_bot_id').notNull(),
  level: text('level').notNull().default('info'),
  message: text('message').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  botIdx: index('idx_bot_logs_bot').on(t.telegramBotId),
  createdIdx: index('idx_bot_logs_created').on(t.createdAt),
}));

export const messageEvents = table('message_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  updateId: integer('update_id').unique(),
  chatId: integer('chat_id').notNull(),
  userTgId: integer('user_tg_id'),
  text: text('text'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (t) => ({
  chatIdx: index('idx_message_events_chat').on(t.chatId),
  userIdx: index('idx_message_events_user').on(t.userTgId),
}));

export const settings = table('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: json('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
