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
  RELAY_ENABLED: 'relay_enabled',
  RELAY_URL: 'relay_url',
  RELAY_INSTANCE_ID: 'relay_instance_id',
  RELAY_TOKEN: 'relay_token',
  COMMUNITY_NAME: 'community_name',
  COMMUNITY_LOGO_PATH: 'community_logo_path',
  COMMUNITY_ACCENT_COLOR: 'community_accent_color',
  GITHUB_PAT: 'github_pat',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  ONBOARDING_CURRENT_STEP: 'onboarding_current_step',
  DEFAULT_TIMEZONE: 'default_timezone',
  LATEST_VERSION: 'latest_version',
  VERSION_CHECK_LAST_RUN: 'version_check_last_run',
  UPDATE_AVAILABLE: 'update_available',
  DISCORD_BOT_TOKEN: 'discord_bot_token',
  DISCORD_BOT_ENABLED: 'discord_bot_enabled',
  IGDB_FILTER_ADULT: 'igdb_filter_adult',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
