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
  /** ROK-471: Default voice channel for Discord Scheduled Events */
  DISCORD_BOT_DEFAULT_VOICE_CHANNEL: 'discord_bot_default_voice_channel',
  /** ROK-490: Grace minutes for voice attendance classification */
  VOICE_ATTENDANCE_GRACE_MINUTES: 'voice_attendance_grace_minutes',
  /** ROK-576: Whether auto-extension of events based on voice activity is enabled */
  EVENT_AUTO_EXTEND_ENABLED: 'event_auto_extend_enabled',
  /** ROK-576: Minutes to extend per rolling increment */
  EVENT_AUTO_EXTEND_INCREMENT_MINUTES: 'event_auto_extend_increment_minutes',
  /** ROK-576: Maximum total overage minutes allowed */
  EVENT_AUTO_EXTEND_MAX_OVERAGE_MINUTES:
    'event_auto_extend_max_overage_minutes',
  /** ROK-576: Minimum voice members required to trigger extension */
  EVENT_AUTO_EXTEND_MIN_VOICE_MEMBERS: 'event_auto_extend_min_voice_members',
  /** ROK-417: Steam Web API key for library/playtime sync */
  STEAM_API_KEY: 'steam_api_key',
  /** ROK-772: IsThereAnyDeal API key for deal/price tracking */
  ITAD_API_KEY: 'itad_api_key',
  /** ROK-542: AI provider key (e.g. 'ollama') */
  AI_PROVIDER: 'ai_provider',
  /** ROK-542: AI model identifier */
  AI_MODEL: 'ai_model',
  /** ROK-542: Ollama instance URL */
  AI_OLLAMA_URL: 'ai_ollama_url',
  /** ROK-542: Whether AI chat feature is enabled */
  AI_CHAT_ENABLED: 'ai_chat_enabled',
  /** ROK-542: Whether AI dynamic categories feature is enabled */
  AI_DYNAMIC_CATEGORIES_ENABLED: 'ai_dynamic_categories_enabled',
  /** ROK-1114: Whether per-user AI nomination suggestions are enabled. */
  AI_SUGGESTIONS_ENABLED: 'ai_suggestions_enabled',
  /** ROK-542: OpenAI API key */
  AI_OPENAI_API_KEY: 'ai_openai_api_key',
  /** ROK-542: Claude (Anthropic) API key */
  AI_CLAUDE_API_KEY: 'ai_claude_api_key',
  /** ROK-542: Google (Gemini) API key */
  AI_GOOGLE_API_KEY: 'ai_google_api_key',
  /** ROK-840: Ollama Docker setup progress step */
  AI_OLLAMA_SETUP_STEP: 'ai_ollama_setup_step',
  /** ROK-840: Ollama Docker setup error message */
  AI_OLLAMA_SETUP_ERROR: 'ai_ollama_setup_error',
  /** ROK-932: Dedicated Discord channel for Community Lineup embeds */
  DISCORD_BOT_LINEUP_CHANNEL: 'discord_bot_lineup_channel',
  /** ROK-1118: Minimum distinct nominations required for building→voting auto-advance. */
  LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS: 'lineup_auto_advance_min_nominations',
  /** ROK-946: Default hours for lineup building phase */
  LINEUP_DEFAULT_BUILDING_HOURS: 'lineup_default_building_hours',
  /** ROK-946: Default hours for lineup voting phase */
  LINEUP_DEFAULT_VOTING_HOURS: 'lineup_default_voting_hours',
  /** ROK-946: Default hours for lineup decided phase */
  LINEUP_DEFAULT_DECIDED_HOURS: 'lineup_default_decided_hours',
  /** ROK-950: Common Ground — weight on voter/game taste-vector cosine similarity. */
  COMMON_GROUND_TASTE_WEIGHT: 'common_ground_taste_weight',
  /** ROK-950: Common Ground — weight when a co-play partner owns the game. */
  COMMON_GROUND_SOCIAL_WEIGHT: 'common_ground_social_weight',
  /** ROK-950: Common Ground — weight when game intensity matches voter intensity bucket. */
  COMMON_GROUND_INTENSITY_WEIGHT: 'common_ground_intensity_weight',
  /** ROK-567: Blend alpha between LLM theme vector and community centroid (0..1). */
  DYNAMIC_CATEGORIES_THEME_CENTROID_BLEND:
    'dynamic_categories_theme_centroid_blend',
  /** ROK-567: How many candidate games to pre-resolve per dynamic category. */
  DYNAMIC_CATEGORIES_CANDIDATE_COUNT: 'dynamic_categories_candidate_count',
  /** ROK-567: Skip weekly generation when pending suggestions exceed this count. */
  DYNAMIC_CATEGORIES_MAX_PENDING: 'dynamic_categories_max_pending',
  /** ROK-1099: Community Insights churn-risk threshold (percent 0-100). */
  COMMUNITY_INSIGHTS_CHURN_THRESHOLD_PCT:
    'community_insights_churn_threshold_pct',
  /** ROK-1099: Churn baseline window (weeks). */
  COMMUNITY_INSIGHTS_BASELINE_WEEKS: 'community_insights_baseline_weeks',
  /** ROK-1099: Churn recent-activity window (weeks). */
  COMMUNITY_INSIGHTS_RECENT_WEEKS: 'community_insights_recent_weeks',
  /** ROK-1099: Community insights snapshot retention in days. */
  COMMUNITY_INSIGHTS_SNAPSHOT_RETENTION_DAYS:
    'community_insights_snapshot_retention_days',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
