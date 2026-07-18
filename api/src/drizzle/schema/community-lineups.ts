import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  smallint,
  unique,
  jsonb,
  varchar,
  boolean,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';
import { events } from './events';

export type LineupStatus = 'building' | 'voting' | 'decided' | 'archived';

/** Visibility mode for a community lineup (ROK-1065). */
export type LineupVisibility = 'public' | 'private';

/**
 * Community Lineups — collaborative game selection (ROK-933).
 *
 * Status flow: building → voting → decided → archived
 * Multiple lineups may be active at once (ROK-1065 removed the
 * "one active at a time" restriction).
 */
export const communityLineups = pgTable('community_lineups', {
  id: serial('id').primaryKey(),
  /** Operator-authored title shown everywhere the lineup appears (ROK-1063). */
  title: varchar('title', { length: 100 }).notNull(),
  /** Optional operator-authored markdown description (ROK-1063). */
  description: text('description'),
  status: text('status', {
    enum: ['building', 'voting', 'decided', 'archived'],
  })
    .default('building')
    .notNull(),
  /**
   * Visibility mode (ROK-1065). 'public' lineups DM every linked member
   * and post lifecycle embeds to the channel; 'private' lineups DM only
   * invitees (plus the creator) and suppress the channel embed.
   */
  visibility: text('visibility', {
    enum: ['public', 'private'],
  })
    .default('public')
    .notNull(),
  targetDate: timestamp('target_date'),
  decidedGameId: integer('decided_game_id').references(() => games.id),
  linkedEventId: integer('linked_event_id').references(() => events.id),
  createdBy: integer('created_by')
    .references(() => users.id)
    .notNull(),
  votingDeadline: timestamp('voting_deadline'),
  phaseDeadline: timestamp('phase_deadline'),
  /**
   * ROK-1253: Set when an operator reverts a lineup backwards (voting→building
   * or decided→voting). Auto-advance evaluation early-returns while the stamp
   * is fresh (< LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS) so the lineup doesn't
   * immediately re-advance through quorum. Cleared lazily on next mutation
   * once TTL elapses, or eagerly on any forward transition.
   */
  autoAdvancePausedAt: timestamp('auto_advance_paused_at'),
  /**
   * ROK-1253: Set when quorum first goes ready; the value is the wall-clock
   * time the BullMQ grace-advance job will re-evaluate quorum and either flip
   * the row to the next phase or null this column. Always paired with a
   * `lineup-grace-<id>` job in the lineup-phase queue.
   */
  pendingAdvanceAt: timestamp('pending_advance_at'),
  phaseDurationOverride: jsonb('phase_duration_override').$type<{
    building?: number;
    voting?: number;
    decided?: number;
    standalone?: boolean;
  } | null>(),
  /** Match threshold percentage for the matching algorithm (0–100, default 35). */
  matchThreshold: integer('match_threshold').notNull().default(35),
  /** Max votes each player can cast during voting (1–10, default 3, ROK-976). */
  maxVotesPerPlayer: smallint('max_votes_per_player').notNull().default(3),
  /** Default tiebreaker mode used when voting deadline expires (ROK-938). */
  defaultTiebreakerMode: text('default_tiebreaker_mode', {
    enum: ['bracket', 'veto'],
  }),
  /** Active tiebreaker FK (ROK-938). Null when no tiebreaker is active. */
  activeTiebreakerId: integer('active_tiebreaker_id'),
  /** Discord channel ID of the creation embed (ROK-1063, for edit-in-place). */
  discordCreatedChannelId: text('discord_created_channel_id'),
  /** Discord message ID of the creation embed (ROK-1063, for edit-in-place). */
  discordCreatedMessageId: text('discord_created_message_id'),
  /**
   * Optional per-lineup Discord channel override (ROK-1064).
   * When set, every lineup lifecycle embed posts to this channel instead
   * of the guild-bound default. Null = use default.
   */
  channelOverrideId: text('channel_override_id'),
  /**
   * Public-share toggle (ROK-1067). When true and `visibility = 'public'`,
   * the lineup is reachable un-authed at `/p/lineup/:publicSlug`.
   * Forced to `false` for private lineups.
   */
  publicShareEnabled: boolean('public_share_enabled').notNull().default(true),
  /**
   * URL-safe nanoid slug used as the un-authed public lineup identifier
   * (ROK-1067). Always generated at creation, even when share is disabled,
   * so a flip of `publicShareEnabled` restores access via the same URL.
   */
  publicSlug: varchar('public_slug', { length: 16 }).notNull().unique(),
  /**
   * Whether the lineup advances into a scheduling poll after Decided
   * (ROK-1302). Default true preserves the original behavior and backfills
   * existing rows. When false, the matching algorithm never promotes a match
   * to 'scheduling', the bandwagon/advance paths refuse promotion, the
   * scheduling poll page 404s, and the decided UI hides the "Pick a time" CTA.
   */
  includeSchedulingPhase: boolean('include_scheduling_phase')
    .notNull()
    .default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Individual game nominations within a lineup. */
export const communityLineupEntries = pgTable(
  'community_lineup_entries',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    nominatedBy: integer('nominated_by')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    note: text('note'),
    carriedOverFrom: integer('carried_over_from'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_lineup_entry_game').on(table.lineupId, table.gameId),
    // ROK-1387: explicit FK name (default exceeded the 63-char limit).
    foreignKey({
      columns: [table.carriedOverFrom],
      foreignColumns: [communityLineups.id],
      name: 'cl_entries_carried_over_from_fk',
    }),
  ],
);

/** User votes on nominated games. */
export const communityLineupVotes = pgTable(
  'community_lineup_votes',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    /** Reserved for future ranked-choice voting. */
    rank: integer('rank'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_lineup_vote_user_game').on(
      table.lineupId,
      table.userId,
      table.gameId,
    ),
  ],
);

/**
 * Per-lineup invitee list (ROK-1065).
 *
 * A private lineup's participation roster: only users rowed here (plus the
 * creator and any admin/operator) may nominate or vote. For public lineups
 * this table is unused.
 */
export const communityLineupInvitees = pgTable(
  'community_lineup_invitees',
  {
    id: serial('id').primaryKey(),
    lineupId: integer('lineup_id')
      .references(() => communityLineups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_lineup_invitee_user').on(table.lineupId, table.userId),
  ],
);
