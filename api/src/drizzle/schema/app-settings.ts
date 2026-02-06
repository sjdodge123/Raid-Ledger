import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Application settings table for storing encrypted credentials.
 * Used for OAuth configuration (Discord, Blizzard, etc.) that can be
 * updated via the admin UI without requiring container restarts.
 */
export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  key: text('key').unique().notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Known setting keys for type safety
 */
export const SETTING_KEYS = {
  DISCORD_CLIENT_ID: 'discord_client_id',
  DISCORD_CLIENT_SECRET: 'discord_client_secret',
  DISCORD_CALLBACK_URL: 'discord_callback_url',
  DEMO_MODE: 'demo_mode',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
