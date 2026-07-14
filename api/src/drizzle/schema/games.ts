import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  real,
  boolean,
  varchar,
  unique,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Games table - unified game data (IGDB metadata + community config).
 * ROK-400: Merged game_registry config columns into this table.
 * Non-IGDB games (e.g., "Generic") use igdbId: null.
 */
export const games = pgTable('games', {
  id: serial('id').primaryKey(),
  igdbId: integer('igdb_id').unique(),
  /** GIN trigram index on this column managed in migration 0095 (Drizzle cannot express gin_trgm_ops). */
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  coverUrl: text('cover_url'),
  /** ROK-183: Array of IGDB genre IDs (e.g., [12, 31] for Role-playing + Adventure) */
  genres: jsonb('genres').$type<number[]>().default([]),
  cachedAt: timestamp('cached_at').defaultNow().notNull(),

  // ROK-229: Expanded fields for game discovery
  summary: text('summary'),
  rating: real('rating'),
  aggregatedRating: real('aggregated_rating'),
  popularity: real('popularity'),
  /** IGDB game mode IDs: 1=single, 2=multi, 3=coop, 5=MMO */
  gameModes: jsonb('game_modes').$type<number[]>().default([]),
  themes: jsonb('themes').$type<number[]>().default([]),
  platforms: jsonb('platforms').$type<number[]>().default([]),
  screenshots: jsonb('screenshots').$type<string[]>().default([]),
  videos: jsonb('videos')
    .$type<{ name: string; videoId: string }[]>()
    .default([]),
  firstReleaseDate: timestamp('first_release_date'),
  playerCount: jsonb('player_count').$type<{
    min: number;
    max: number;
  } | null>(),
  /** Twitch category ID for streams lookup (may differ from IGDB ID) */
  twitchGameId: text('twitch_game_id'),
  /** ROK-417: Steam AppID for library matching (from IGDB external_games category=1) */
  steamAppId: integer('steam_app_id'),
  /** Whether the game supports cross-platform play (inferred from IGDB or manual) */
  crossplay: boolean('crossplay'),
  /** ROK-231: Hidden games are excluded from user-facing search/discovery */
  hidden: boolean('hidden').notNull().default(false),
  /** ROK-231: Banned games are tombstoned — excluded from sync, search, and discovery */
  banned: boolean('banned').notNull().default(false),

  // ROK-400: Config columns (formerly in game_registry)
  /** Abbreviated display name for compact UI contexts (breadcrumbs, chips) */
  shortName: varchar('short_name', { length: 30 }),
  /** Hex color for UI theming */
  colorHex: varchar('color_hex', { length: 7 }),
  /** Whether this game has role-based composition (Tank/Healer/DPS) */
  hasRoles: boolean('has_roles').default(false).notNull(),
  /** Whether this game has specializations/specs */
  hasSpecs: boolean('has_specs').default(false).notNull(),
  /** Whether this game is enabled for event/character creation */
  enabled: boolean('enabled').default(true).notNull(),
  /** ROK-772: ITAD (IsThereAnyDeal) game UUID for deal/price tracking */
  itadGameId: text('itad_game_id').unique(),
  /** ROK-773: ITAD boxart URL (fallback cover image) */
  itadBoxartUrl: text('itad_boxart_url'),
  /** ROK-773: ITAD tags (genre-like labels from ITAD) */
  itadTags: jsonb('itad_tags').$type<string[]>().default([]),
  /** Maximum characters a user can register per game */
  maxCharactersPerUser: integer('max_characters_per_user')
    .default(10)
    .notNull(),
  /** ROK-788: Blizzard API namespace prefix (e.g., 'classic1x', 'classic', 'classicann') */
  apiNamespacePrefix: text('api_namespace_prefix'),

  // ROK-818: ITAD pricing data (synced via cron)
  /** Current best deal price from ITAD */
  itadCurrentPrice: numeric('itad_current_price', { precision: 10, scale: 2 }),
  /** Current discount percentage (0-100) */
  itadCurrentCut: integer('itad_current_cut'),
  /** Store name offering the current deal */
  itadCurrentShop: text('itad_current_shop'),
  /** URL to the current deal */
  itadCurrentUrl: text('itad_current_url'),
  /** Historical lowest price ever */
  itadLowestPrice: numeric('itad_lowest_price', { precision: 10, scale: 2 }),
  /** Historical lowest discount percentage (0-100) */
  itadLowestCut: integer('itad_lowest_cut'),
  /** Last successful ITAD pricing sync */
  itadPriceUpdatedAt: timestamp('itad_price_updated_at'),
  /** ROK-934: Whether this game is in early access (from ITAD) */
  earlyAccess: boolean('early_access').default(false).notNull(),
  /** ROK-986: IGDB enrichment tracking status */
  igdbEnrichmentStatus: varchar('igdb_enrichment_status', {
    length: 20,
  }).default('pending'),
  /** ROK-986: Number of failed IGDB enrichment attempts */
  igdbEnrichmentRetryCount: integer('igdb_enrichment_retry_count')
    .default(0)
    .notNull(),

  // ROK-1377: URL-only / free-to-play games (e.g. Chao Chao — not on Steam).
  /** Homepage / play URL for games with no storefront (rendered as "Play ↗"). */
  websiteUrl: text('website_url'),
  /** Whether the game is free to play (drives a "Free" badge). */
  isFreeToPlay: boolean('is_free_to_play').default(false).notNull(),

  // ROK-1375: install/download footprint (resolved from Steam depots, or manual).
  /** On-disk install footprint in bytes (base + one language + one OS depots). */
  installSizeBytes: bigint('install_size_bytes', { mode: 'number' }),
  /** Compressed download size in bytes (drives the "~N min" download estimate). */
  downloadSizeBytes: bigint('download_size_bytes', { mode: 'number' }),
  /** How the size was obtained: 'steam_depot' (auto) or 'manual' (admin override). */
  installSizeSource: varchar('install_size_source', { length: 20 }),
  /** Last time the size was resolved. */
  installSizeUpdatedAt: timestamp('install_size_updated_at'),

  // ROK-1397: Co-Optimus co-op enrichment. UPDATE-only sync (never INSERTs
  // into games — keeps this path outside the name-dedup guard); written
  // exclusively by api/src/cooptimus/. Precedence rule: cooptimus_online_max
  // WINS over player_count.max when non-null; NULL both = no capability claim.
  /** Co-Optimus game id of the chosen platform entry (re-sync key). */
  cooptimusId: integer('cooptimus_id'),
  /** Max online co-op players — the "supports N+ online co-op" filter field. */
  cooptimusOnlineMax: integer('cooptimus_online_max'),
  /** Max couch/local co-op players. */
  cooptimusCouchMax: integer('cooptimus_couch_max'),
  /** Max LAN co-op players. */
  cooptimusLanMax: integer('cooptimus_lan_max'),
  /** Split-screen support. */
  cooptimusSplitscreen: boolean('cooptimus_splitscreen'),
  /** Drop-in/drop-out support. */
  cooptimusDropIn: boolean('cooptimus_drop_in'),
  /** Campaign co-op support. */
  cooptimusCampaignCoop: boolean('cooptimus_campaign_coop'),
  /** Combo (same-session local+online) — parsed from featurelist text; NOT derivable from local∧online. */
  cooptimusComboCoop: boolean('cooptimus_combo_coop'),
  /** Attribution linkback to the Co-Optimus game page. */
  cooptimusUrl: text('cooptimus_url'),
  /** Display-only extras: { system, steamAppId, featurelist, coopExperience, description, downloadableOnly }. Detail endpoint only. */
  cooptimusExtras: jsonb('cooptimus_extras'),
  /** Last sync. Set even on an empty result — a positive "no co-op entry" signal, distinct from never-synced NULL. */
  cooptimusSyncedAt: timestamp('cooptimus_synced_at'),
});

/**
 * Event Types - Game-specific event type templates.
 * ROK-400: FK now references games.id (integer) instead of game_registry.id (uuid).
 * @example WoW -> Mythic Raid (20 players), Heroic Raid (30 players)
 */
export const eventTypes = pgTable(
  'event_types',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    /** Default player cap for this event type (null = unlimited) */
    defaultPlayerCap: integer('default_player_cap'),
    /** Default event duration in minutes */
    defaultDurationMinutes: integer('default_duration_minutes'),
    /** Whether this event type requires role composition (Tank/Healer/DPS) */
    requiresComposition: boolean('requires_composition')
      .default(false)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    gameSlugUnique: unique('event_types_game_slug_unique').on(
      table.gameId,
      table.slug,
    ),
    /** L-3: Standalone index for filtering event types by game */
    gameIdIdx: index('idx_event_types_game_id').on(table.gameId),
  }),
);
