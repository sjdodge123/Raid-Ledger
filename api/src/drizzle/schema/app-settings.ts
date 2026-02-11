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
  IGDB_CLIENT_ID: 'igdb_client_id',
  IGDB_CLIENT_SECRET: 'igdb_client_secret',
  BLIZZARD_CLIENT_ID: 'blizzard_client_id',
  BLIZZARD_CLIENT_SECRET: 'blizzard_client_secret',
  DEMO_MODE: 'demo_mode',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
