import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  smallint,
  unique,
  index,
  jsonb,
  varchar,
  boolean,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
export const communityLineups = pgTable(
  'community_lineups',
  {
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
    /**
     * ROK-1444: early-advance target, as a percentage of the dynamic nomination
     * cap (`nominationCap(distinctNominators)` = max(20, nominators * 5)). When
     * the entry count reaches this share of the cap, the building phase opens
     * voting early instead of waiting for `phase_deadline`.
     *
     * NULL disables the feature and preserves deadline-only behaviour exactly.
     * The global `LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS` floor still applies as an
     * absolute minimum on top of this percentage — a 10% target on a 20-cap
     * lineup still will not advance at 2 entries when the floor is 4.
     */
    nominationTargetPct: smallint('nomination_target_pct'),
    /**
     * ROK-1444: monotonic high-water mark of the dynamic nomination cap.
     *
     * The live cap is `max(20, distinctNominators * 5)`, and distinct nominators
     * can DECREASE — removing a nominator's last entry drops the count, which
     * collapses the cap and RAISES the filled percentage with no new nomination.
     * That let a deletion satisfy the target and open voting (verified: 21/25 =
     * 84% became 20/20 = 100% when one member removed their only game).
     *
     * Ratcheting the cap upward and never down removes the failure mode entirely
     * and keeps the publicly-displayed denominator from jittering. Used as the
     * effective cap by BOTH the target predicate and `validateNominationCap`'s
     * rejection ceiling — they must not diverge, or a lineup could reject new
     * nominations at the live ceiling while the target still reads under 100%.
     */
    nominationCapPeak: smallint('nomination_cap_peak'),
    /**
     * ROK-1444 (rising-edge arm). Stamped the first time the quorum check
     * OBSERVES the target as not-yet-met. The target may only fire once this is
     * non-null, which guarantees the advance is triggered by a genuine crossing
     * rather than a standing condition.
     *
     * Why this is needed: carry-over (`carryOverFromLastDecided`) can seed a
     * brand-new lineup with entries that already satisfy the target, and the
     * denominator itself moves when the nominator count grows. Without this
     * latch such a lineup would advance out of building on its first mutation.
     */
    nominationTargetBelowSeenAt: timestamp('nomination_target_below_seen_at'),
    /**
     * ROK-1444 (sticky disarm — THE revert trap guard). Stamped when an operator
     * reverts `voting -> building`, and never cleared automatically.
     *
     * Deliberately NOT reusing `auto_advance_paused_at`: that stamp is bounded by
     * `LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS` (24h default), and ROK-1296 could only
     * make the TTL safe by ALSO clearing the `*_submitted_at` stamps that
     * satisfied the quorum. A nomination count has no such clearable state — the
     * entries ARE what the operator reverted in order to edit — so a TTL would
     * re-advance the lineup the moment it expired. Rising-edge alone is also
     * insufficient: deleting a weak game and adding a better one re-crosses the
     * target and IS a rising edge.
     *
     * Consequence, by design: a lineup reverted out of voting stays manually
     * controlled for the rest of its life. Forward transitions do NOT clear it.
     */
    nominationTargetDisarmedAt: timestamp('nomination_target_disarmed_at'),
    // ==========================================================================
    // ROK-1374 tie hold (D2). A completed vote that produced no decidable
    // winner parks the lineup HERE rather than in `community_lineup_tiebreakers`
    // — that table's `mode` is NOT NULL, so "tied, nobody has picked a mode yet"
    // is unrepresentable there without a schema-wide ripple. The hold is a
    // property of the lineup, exactly like `pendingAdvanceAt` above.
    // A tiebreaker row is still created only when a human picks a mode.
    // ==========================================================================
    /**
     * Stamped the first time a tie hold is opened. The null→set edge is the
     * announce signal (D4) — three code paths and BullMQ retries can all reach
     * `openTieHold`, so re-entry refreshes the payload columns below but never
     * re-stamps this one. Null = no tie hold.
     */
    tieDetectedAt: timestamp('tie_detected_at'),
    /** Tied game ids at detection; refreshed on re-entry. */
    tieGameIds: jsonb('tie_game_ids').$type<number[] | null>(),
    /** The vote count the tied games share. */
    tieVoteCount: integer('tie_vote_count'),
    /**
     * D13: `max(phaseDeadline at detection, tieDetectedAt) + 7 days`, falling
     * back to `tieDetectedAt + 7 days` when the lineup has no phase deadline.
     * Set once with `tieDetectedAt` and never moved by re-entry.
     */
    tieExpiresAt: timestamp('tie_expires_at'),
    /** Stamped by the expiry sweep. Expiry archives; it never picks a winner. */
    tieExpiredAt: timestamp('tie_expired_at'),
    /**
     * The GAME the creator/operator picked off the readiness card (the issue's
     * `[ Pick Deep Rock ] [ Pick Valheim ]`). Reversible while the grace claim
     * is pending; final once the advance fires and the lineup is decided.
     */
    tiePickGameId: integer('tie_pick_game_id').references(() => games.id),
    /** D5: when the pick was made; the grace window runs from here. */
    tiePickAt: timestamp('tie_pick_at'),
    /** D5: who picked — creator or operator/admin. Audit trail + UI copy. */
    tiePickBy: integer('tie_pick_by').references(() => users.id),
    /** D7: channel of the tie announcement, so it is EDITED, never reposted. */
    tieAnnounceChannelId: text('tie_announce_channel_id'),
    /** D7: message id of the tie announcement. Cleared on a 10008 from Discord. */
    tieAnnounceMessageId: text('tie_announce_message_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // ROK-1374: the expiry sweep scans OPEN tie holds only. Partial, because
    // the overwhelming majority of lineups never tie.
    index('idx_lineup_tie_expires')
      .on(table.tieExpiresAt)
      .where(
        sql`${table.tieDetectedAt} IS NOT NULL AND ${table.tieExpiredAt} IS NULL`,
      ),
  ],
);

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
