import {
  pgTable,
  numeric,
  serial,
  text,
  timestamp,
  varchar,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    discordId: text('discord_id').unique(), // Nullable for local-only users who link Discord later
    steamId: text('steam_id').unique(), // Nullable — linked via Steam OpenID 2.0 (ROK-417)
    username: text('username').notNull(),
    displayName: varchar('display_name', { length: 30 }),
    avatar: text('avatar'),
    customAvatarUrl: text('custom_avatar_url'),
    role: text('role', { enum: ['member', 'operator', 'admin'] })
      .default('member')
      .notNull(),
    onboardingCompletedAt: timestamp('onboarding_completed_at'),
    /** Timestamp of last game time template confirmation (ROK-999). Null = never confirmed. */
    gameTimeConfirmedAt: timestamp('game_time_confirmed_at'),
    /** Timestamp when the user left the Discord guild and was auto-deactivated (ROK-1260). Null = active. */
    deactivatedAt: timestamp('deactivated_at'),
    /** ROK-313: soft-removal (kick) state. Null = not kicked. Cooldown enforced at auth time. */
    kickedAt: timestamp('kicked_at'),
    kickReason: text('kick_reason'),
    /** ROK-313: permanent ban. Null = not banned. Blocks all auth. */
    bannedAt: timestamp('banned_at'),
    banReason: text('ban_reason'),
    // ROK-1374 (D9): downstream connection speed, per-user and PRIVATE.
    // Dedicated columns rather than a `user_preferences` KV row because the
    // readiness card queries this per viewer on a hot path and has to reason
    // about staleness (90 days) and consent revocation in SQL.
    //
    // PRIVACY (STRICT): these four values are the ONLY things persisted from a
    // speed test. No M-Lab server hostnames/locations, no latency or jitter
    // series, no IP-adjacent diagnostics, no raw ndt7 result object. The
    // figure is never returned for another user and never appears in an embed
    // or a DM.
    /** Measured/entered downstream throughput in Mbps. */
    connectionDownstreamMbps: numeric('connection_downstream_mbps', {
      precision: 8,
      scale: 2,
    }),
    /** How it was obtained: 'ndt7' | 'manual'. */
    connectionSpeedSource: varchar('connection_speed_source', { length: 20 }),
    /** Drives the 90-day staleness rule for auto re-measurement. */
    connectionSpeedMeasuredAt: timestamp('connection_speed_measured_at'),
    /** Null = no consent. Revoking sets it back to null AND nulls the three
     * columns above — revocation deletes the datum, not just the permission. */
    speedTestConsentAt: timestamp('speed_test_consent_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'display_name_length',
      sql`${table.displayName} IS NULL OR (LENGTH(${table.displayName}) >= 2 AND LENGTH(${table.displayName}) <= 30)`,
    ),
  ],
);
