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
  DISCORD_BOT_DEFAULT_CHANNEL: 'discord_bot_default_channel',
  IGDB_FILTER_ADULT: 'igdb_filter_adult',
  DISCORD_BOT_SETUP_COMPLETED: 'discord_bot_setup_completed',
  DISCORD_BOT_COMMUNITY_NAME: 'discord_bot_community_name',
  DISCORD_BOT_TIMEZONE: 'discord_bot_timezone',
  CLIENT_URL: 'client_url',
  DISCORD_EMOJI_TANK: 'discord_emoji_tank',
  DISCORD_EMOJI_HEALER: 'discord_emoji_healer',
  DISCORD_EMOJI_DPS: 'discord_emoji_dps',
  DISCORD_EMOJI_CLASS_WARRIOR: 'discord_emoji_class_warrior',
  DISCORD_EMOJI_CLASS_PALADIN: 'discord_emoji_class_paladin',
  DISCORD_EMOJI_CLASS_HUNTER: 'discord_emoji_class_hunter',
  DISCORD_EMOJI_CLASS_ROGUE: 'discord_emoji_class_rogue',
  DISCORD_EMOJI_CLASS_PRIEST: 'discord_emoji_class_priest',
  DISCORD_EMOJI_CLASS_DEATHKNIGHT: 'discord_emoji_class_deathknight',
  DISCORD_EMOJI_CLASS_SHAMAN: 'discord_emoji_class_shaman',
  DISCORD_EMOJI_CLASS_MAGE: 'discord_emoji_class_mage',
  DISCORD_EMOJI_CLASS_WARLOCK: 'discord_emoji_class_warlock',
  DISCORD_EMOJI_CLASS_MONK: 'discord_emoji_class_monk',
  DISCORD_EMOJI_CLASS_DRUID: 'discord_emoji_class_druid',
  DISCORD_EMOJI_CLASS_DEMONHUNTER: 'discord_emoji_class_demonhunter',
  DISCORD_EMOJI_CLASS_EVOKER: 'discord_emoji_class_evoker',
  /** ROK-293: Whether ad-hoc voice channel events are enabled */
  AD_HOC_EVENTS_ENABLED: 'ad_hoc_events_enabled',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
