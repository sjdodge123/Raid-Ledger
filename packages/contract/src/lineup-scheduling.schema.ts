import { z } from 'zod';
import {
  LineupScheduleSlotSchema,
  MatchDetailResponseSchema,
} from './lineup-match.schema.js';

// ============================================================
// Request Schemas (ROK-965)
// ============================================================

/**
 * A vote's polarity (ROK-1617). "Not answered" is deliberately NOT a member
 * of this enum — it is the absence of a vote row, which is what pressing the
 * same stance twice restores.
 */
export const ScheduleVoteStanceSchema = z.enum(['yes', 'no']);

export type ScheduleVoteStance = z.infer<typeof ScheduleVoteStanceSchema>;

/**
 * Where the action that produced a vote was initiated (ROK-1550).
 *
 * `'discord'` is claimed by the poll page when it was opened from a poll-card
 * link carrying `?src=discord`; `'web'` covers every other arrival. This is
 * provenance for a product decision ("is the Discord card worth its upkeep?"),
 * not an authorisation input — the client asserts it and the server believes
 * it, which is why the enum is closed rather than a free-text label.
 *
 * Declared ahead of the request bodies below because both of them — the vote
 * AND the suggestion, whose auto-vote is a real vote row — carry it.
 */
export const ScheduleVoteSourceSchema = z.enum(['web', 'discord']);

export type ScheduleVoteSource = z.infer<typeof ScheduleVoteSourceSchema>;

/**
 * Body for suggesting a new time slot.
 *
 * `source` (ROK-1550 review fix) records where the suggestion was made from.
 * Suggesting auto-votes for the new slot server-side, so without it every
 * "find a better time" arriving on the Discord card's link would be recorded
 * as a web vote and undercount the card. Defaults to `'web'`, which is what
 * an older client's body honestly is; an unknown value is a 400 rather than a
 * silent fallback, so a typo in a link surfaces instead of polluting the
 * measurement.
 */
export const SuggestSlotSchema = z.object({
  proposedTime: z.string().datetime({ offset: true }),
  source: ScheduleVoteSourceSchema.default('web'),
});

export type SuggestSlotDto = z.infer<typeof SuggestSlotSchema>;

/**
 * Body for toggling a vote on a schedule slot.
 *
 * `stance` defaults to `'yes'`, so a pre-ROK-1617 client that posts only
 * `slotId` keeps its exact old behaviour (tap = yes, tap again = clear).
 *
 * `source` defaults to `'web'` (ROK-1550): a client too old to send the field
 * — including a browser still holding the pre-ROK-1550 bundle — is recorded
 * as a web vote, which is what it is. An unknown value is a 400, never a
 * silent fallback, so a typo in a link surfaces instead of quietly polluting
 * the very number this column exists to measure.
 */
export const ToggleScheduleVoteSchema = z.object({
  slotId: z.number().int().positive(),
  stance: ScheduleVoteStanceSchema.default('yes'),
  source: ScheduleVoteSourceSchema.default('web'),
});

/**
 * What the vote route settled on (ROK-1617).
 *
 * `voted` keeps its pre-stance meaning exactly — "the caller now holds a YES
 * on this slot" — so no existing consumer silently changes behaviour when a
 * `no` lands. `stance` is the full answer, `null` meaning not answered.
 */
export const ToggleScheduleVoteResponseSchema = z.object({
  voted: z.boolean(),
  stance: ScheduleVoteStanceSchema.nullable(),
});

export type ToggleScheduleVoteResponseDto = z.infer<
  typeof ToggleScheduleVoteResponseSchema
>;

export type ToggleScheduleVoteDto = z.infer<typeof ToggleScheduleVoteSchema>;

/** Body for creating an event from a selected slot. */
export const CreateEventFromSlotSchema = z.object({
  slotId: z.number().int().positive(),
  /** When true, creates a weekly recurring series for 4 weeks. */
  recurring: z.boolean().optional().default(false),
});

export type CreateEventFromSlotDto = z.infer<typeof CreateEventFromSlotSchema>;

/**
 * Body for cancelling a scheduling poll (ROK-1219 / F-38).
 * Optional reason surfaced to voters in the cancellation notification.
 * Additive — legacy no-body callers still validate via `safeParse(body ?? {})`.
 */
export const CancelSchedulePollSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export type CancelSchedulePollDto = z.infer<typeof CancelSchedulePollSchema>;

/**
 * Response for the manual "Remind voters" nudge (ROK-1395):
 * POST /lineups/:lineupId/schedule/:matchId/remind.
 * `reminded` = notifications created by this call; `skipped` = audience
 * members suppressed by the 24h per-recipient dedup, whose notification
 * preferences disable community-lineup in-app notifications, or whose
 * dispatch failed. A repeat call inside
 * the 1h per-match cooldown does NOT return this shape — it fails with
 * HTTP 429 and a human-readable `message` the UI surfaces via toast.
 */
export const RemindVotersResponseSchema = z.object({
  reminded: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export type RemindVotersResponseDto = z.infer<typeof RemindVotersResponseSchema>;

/**
 * Request body for the organiser "Rally" nudge (ROK-1635).
 *
 * `slotId` names the time the rally asks about, so Rally on any time card
 * rallies THAT card's time — its recipients are the poll members with no
 * stance on that slot. The field is OPTIONAL on purpose: a body without it
 * (including the empty body a pre-ROK-1635 browser tab still posts) keeps the
 * original behaviour and rallies the LEADING time.
 *
 * The slot must belong to the match (404 `Time not found in this poll`) and
 * must not have passed (400 `That time has already passed`); both are server
 * checks, because a stale client can name either.
 */
export const RallyNonVotersRequestSchema = z.object({
  slotId: z.number().int().positive().optional(),
});

export type RallyNonVotersRequestDto = z.infer<
  typeof RallyNonVotersRequestSchema
>;

/**
 * Response for the organiser "Rally" nudge (ROK-1618):
 * POST /lineups/:lineupId/schedule/:matchId/rally.
 *
 * The rally asks whether the LEADING time works, so its audience is poll
 * members with NO stance (yes or no) on the LEADING future slot — not, as
 * first shipped, members with no stance on any future slot. Deactivated users
 * are excluded; there is no member-age floor (a rally is a manual action).
 *
 * `pending`  = members with no stance on the leading slot, EXCLUDING the
 *              caller: an organiser is never nudged by their own rally, so a
 *              caller who still owes an answer is not counted here.
 * `nudged`   = notifications actually created by this call.
 * `skipped`  = pending members suppressed by the rally's OWN 6h per-member key
 *              (`sched-poll-rally:{match}:{slot}:{user}`), whose notification
 *              preferences disable community-lineup DMs, or whose dispatch
 *              threw. `pending === nudged + skipped`.
 * `cooldownUntil` = ISO instant before which a further rally returns 429.
 *
 * A call inside the cooldown does NOT return this shape: HTTP 429 with a
 * human-readable `message` the UI toasts.
 */
export const RallyNonVotersResponseSchema = z.object({
  pending: z.number().int().nonnegative(),
  nudged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  cooldownUntil: z.string().datetime(),
});

export type RallyNonVotersResponseDto = z.infer<
  typeof RallyNonVotersResponseSchema
>;

/**
 * The ONE success string for a completed rally (ROK-1618, AC3).
 *
 * Lives in the contract — beside the DTO it describes — because the API unit
 * spec and the web toast/announcer both read it. A web-side re-wording would
 * make the two surfaces disagree about what the same 200 body meant.
 *
 * The empty audience is reported FIRST: with `pending === 0` there is nothing
 * to have deduped, so "already rallied" would be a lie. Its wording names the
 * LEADING time, because a member who voted on some other day is still pending
 * here — saying "everyone has voted" was the operator-rejected bug.
 *
 * @param pending - Members with no stance on the leading slot, minus the caller.
 * @param nudged - Notifications actually created by the call.
 * @param skipped - Pending members the dedup or a failed dispatch suppressed.
 *   Kept in the signature so every call site passes the whole 200 body and the
 *   wording can start naming skips without touching a caller.
 * @returns Human-readable one-liner for the toast and the screen reader.
 */
export function summariseRally(
  pending: number,
  nudged: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  skipped: number,
): string {
  if (pending === 0) return 'Everyone has answered this time — nobody to rally';
  if (nudged > 0) return `Nudged ${nudged} member${nudged === 1 ? '' : 's'}`;
  return 'Everyone left was already rallied recently';
}

// ============================================================
// Response Schemas (ROK-965)
// ============================================================

/** One voter's identity on a slot, in either stance list. */
export const ScheduleVoteVoterSchema = z.object({
  userId: z.number(),
  displayName: z.string(),
  avatar: z.string().nullable(),
  discordId: z.string().nullable(),
  customAvatarUrl: z.string().nullable(),
});

/** Enriched slot with voter details. */
export const ScheduleSlotWithVotesSchema = LineupScheduleSlotSchema.extend({
  /**
   * YES votes only — unchanged meaning (ROK-1617). Every surface that counts
   * `votes.length` as "how many want this time" stays correct; the `no`s live
   * in their own array rather than inflating this one.
   */
  votes: z.array(ScheduleVoteVoterSchema),
  /** ROK-1617: members who said this time does NOT work. */
  noVotes: z.array(ScheduleVoteVoterSchema).default([]),
});

export type ScheduleSlotWithVotesDto = z.infer<typeof ScheduleSlotWithVotesSchema>;

/** Full scheduling poll page response. */
export const SchedulePollPageResponseSchema = z.object({
  match: MatchDetailResponseSchema,
  slots: z.array(ScheduleSlotWithVotesSchema),
  /** Slots the viewer voted YES on. */
  myVotedSlotIds: z.array(z.number()),
  /** ROK-1617: slots the viewer marked as NOT working for them. */
  myNoSlotIds: z.array(z.number()).default([]),
  lineupStatus: z.string(),
  /** Count of distinct users who voted on any slot (ROK-1015). */
  uniqueVoterCount: z.number().int().optional(),
  /** Slot IDs that conflict with the authenticated user's existing events (ROK-1031). */
  conflictingSlotIds: z.array(z.number()).optional(),
  /** Per-slot conflicting event titles for the "⚠ Conflicts with <event>" tooltip (ROK-1032). */
  slotConflicts: z
    .array(z.object({ slotId: z.number(), eventTitles: z.array(z.string()) }))
    .optional(),
  /** Lineup phase deadline (ISO). Null when no deadline configured (ROK-1217). */
  phaseDeadline: z.string().nullable().optional(),
  /**
   * True when this poll belongs to a standalone scheduling lineup (started
   * via the /events "Schedule a Game" flow, marked by
   * `phaseDurationOverride.standalone === true`) rather than a from-match
   * lineup (ROK-1300). Drives the composite's mode: standalone → noRibbon
   * hero + "started by you" badge with no cross-match refs; from-match →
   * 4-phase ribbon + "Match N of M". Server always sets it.
   */
  isStandalone: z.boolean(),
  /**
   * ROK-1545: the poll's lifecycle, derived server-side by the SAME helper the
   * Discord embed uses (`pollStatusFromMatch`) so the two surfaces can never
   * disagree. `closed` is the expired poll — the deadline passed (or the
   * parent lineup was archived by the phase job) with no lock-in.
   */
  pollStatus: z.enum(['open', 'locked_in', 'cancelled', 'closed']),
  /**
   * ROK-1545: ISO start time the lock-in selected (the linked event's start,
   * falling back to the winning slot). Null unless `pollStatus` is
   * `locked_in`.
   */
  lockedInTime: z.string().nullable(),
  /**
   * ROK-1545: the operator's cancellation reason, persisted on the match row.
   * Null unless `pollStatus` is `cancelled` (and the operator gave one).
   */
  cancelReason: z.string().nullable(),
  /**
   * ROK-1545 (F-07): whether the viewer may cast a vote. False on a terminal
   * poll, and false for a non-member of a PRIVATE lineup — those votes are
   * rejected server-side, so no affordance is rendered. True for a non-member
   * of a PUBLIC lineup: voting self-enrols them, which is deliberate.
   */
  canVote: z.boolean(),
  /**
   * Review fix (ROK-1607): whether the viewer may SUGGEST a new time.
   *
   * Normally this tracks `canVote`. It diverges in exactly one state: a poll
   * whose deadline is still ahead but whose every proposed time has passed.
   * That poll is `closed` (nothing left to vote for) and yet the Discord card
   * invites "suggest a new time" — so the suggest form stays, the vote buttons
   * do not, and the server keeps accepting the suggestion. Once the DEADLINE
   * passes, this is false like everything else.
   */
  canSuggest: z.boolean().default(false),
  /**
   * ROK-1610: whether the viewer may finish this EXPIRED poll by locking
   * `lockInSlotId` in. Organisers only (lineup creator / admin / operator),
   * and only while a future, voted slot exists. Always false on an open,
   * cancelled or already-locked-in poll — an open poll offers its ordinary
   * per-slot lock-in instead.
   */
  canLockIn: z.boolean().default(false),
  /**
   * ROK-1610: on an expired poll, the leading slot that is still in the
   * FUTURE and has at least one vote — the time a "Schedule <time>" action
   * would pick. Null when every slot has passed (then the page offers only
   * "start a new poll") or the poll is not expired. Present regardless of the
   * viewer, so the banner can name the time; `canLockIn` gates the action.
   */
  lockInSlotId: z.number().int().nullable().default(null),
});

export type SchedulePollPageResponseDto = z.infer<typeof SchedulePollPageResponseSchema>;

/** Lightweight banner for the events page. */
export const SchedulingBannerSchema = z.object({
  lineupId: z.number(),
  polls: z.array(
    z.object({
      matchId: z.number(),
      gameName: z.string(),
      gameCoverUrl: z.string().nullable(),
      memberCount: z.number(),
      slotCount: z.number(),
    }),
  ),
});

export type SchedulingBannerDto = z.infer<typeof SchedulingBannerSchema>;

/** Other scheduling polls for the current user. */
export const OtherPollsResponseSchema = z.object({
  polls: z.array(
    z.object({
      matchId: z.number(),
      gameName: z.string(),
      gameCoverUrl: z.string().nullable(),
      memberCount: z.number(),
    }),
  ),
});

export type OtherPollsResponseDto = z.infer<typeof OtherPollsResponseSchema>;
