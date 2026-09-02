/**
 * "Might want in" — `GET /lfg/:gameId/suggestions` (ROK-1463 §C).
 *
 * Three independent signals are unioned per user and reported as REASONS, so
 * the FE can say why somebody is being suggested instead of showing a bare
 * list: `played` (they turned up for this game recently), `owns` (Steam
 * library) and `hearted` (an un-suppressed interest heart).
 *
 * Closest prior art is `standalone-poll-notification.service.ts::findRecipients`,
 * which filters none of the three things that matter here — interest SOURCE,
 * user eligibility, and a result cap. This module deliberately does all three.
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type {
  LfgSuggestionDto,
  LfgSuggestionReason,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { HEART_SOURCES } from '../igdb/igdb-interest.helpers';
import { eligibleUser, liveIntent, type LfgDb } from './lfg-query.helpers';
import {
  LFG_SUGGESTIONS_LIMIT,
  LFG_SUGGESTIONS_PLAYED_DAYS,
} from './lfg.constants';
import { fetchPlayedForGame } from './lfg-suggestions-played.helpers';

/** The `game_interests.source` that means "owns it on Steam". */
const STEAM_LIBRARY_SOURCE = 'steam_library';

/**
 * SQL predicate: no un-heart NEWER than this `game_interests` row exists.
 *
 * Correlated on the heart row's own `created_at`, so a user with an old
 * suppressed heart AND a fresh one keeps the fresh one (Codex #13).
 *
 * @param gameId - Game whose suppressions to consider.
 */
function notSuppressedSince(gameId: number) {
  return sql`NOT EXISTS (
    SELECT 1 FROM game_interest_suppressions s
    WHERE s.user_id = ${schema.gameInterests.userId}
      AND s.game_id = ${gameId}
      AND s.suppressed_at > ${schema.gameInterests.createdAt}
  )`;
}

/** Reason order the DTO promises, strongest evidence first. */
const REASON_ORDER: LfgSuggestionReason[] = ['played', 'owns', 'hearted'];

/** A user under consideration, before privacy and eligibility are applied. */
interface Candidate {
  reasons: Set<LfgSuggestionReason>;
  lastPlayedAt: Date | null;
}

/** Profile columns plus the one privacy flag that governs `played`. */
interface Profile {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** True when the user set `show_activity` to false (`PRIVACY_FILTER`). */
  optedOut: boolean;
}

/** One `(user, reason)` pair a signal produced. */
interface ReasonHit {
  userId: number;
  reason: LfgSuggestionReason;
}

/**
 * Interest rows for the game, split into `owns` and `hearted`.
 *
 * A heart the user explicitly removed leaves a `game_interest_suppressions`
 * row behind (ROK-444); suggesting them off a heart they deleted would be
 * re-surfacing an opt-out.
 *
 * That suppression is scoped to the HEART sources only (W3 / Codex P2-d).
 * `steam_library` is a fact about the user's library that the un-heart never
 * spoke to, and a stale suppression must not delete a current `owns`.
 *
 * It is also scoped in TIME (Codex #13): the row records one un-heart at one
 * moment, so it only masks hearts that predate it. A user who hearts the game
 * again afterwards has overruled their own opt-out.
 */
async function fetchInterests(db: LfgDb, gameId: number): Promise<ReasonHit[]> {
  const rows = await db
    .select({
      userId: schema.gameInterests.userId,
      source: schema.gameInterests.source,
    })
    .from(schema.gameInterests)
    .where(
      and(
        eq(schema.gameInterests.gameId, gameId),
        or(
          eq(schema.gameInterests.source, STEAM_LIBRARY_SOURCE),
          and(
            inArray(schema.gameInterests.source, HEART_SOURCES),
            notSuppressedSince(gameId),
          ),
        ),
      ),
    );
  return rows.map((row) => ({
    userId: row.userId,
    reason: row.source === STEAM_LIBRARY_SOURCE ? 'owns' : 'hearted',
  }));
}

/** Fold the raw signals into one candidate per user. */
function collectCandidates(
  played: Map<number, Date>,
  interests: ReasonHit[],
): Map<number, Candidate> {
  const candidates = new Map<number, Candidate>();
  const ensure = (userId: number): Candidate => {
    const existing = candidates.get(userId);
    if (existing) return existing;
    const created: Candidate = { reasons: new Set(), lastPlayedAt: null };
    candidates.set(userId, created);
    return created;
  };
  for (const [userId, playedAt] of played) {
    const candidate = ensure(userId);
    candidate.reasons.add('played');
    candidate.lastPlayedAt = playedAt;
  }
  for (const hit of interests) ensure(hit.userId).reasons.add(hit.reason);
  return candidates;
}

/**
 * Users already in the group — they do not need suggesting into it.
 *
 * Reuses the shared `liveIntent()` predicate rather than re-inlining
 * status + expiry here (S3), which is why `users` is joined: that predicate
 * carries the eligibility half too.
 */
async function fetchLiveHolders(
  db: LfgDb,
  gameId: number,
): Promise<Set<number>> {
  const rows = await db
    .select({ userId: schema.lfgIntents.userId })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(and(eq(schema.lfgIntents.gameId, gameId), liveIntent(new Date())));
  return new Set(rows.map((r) => r.userId));
}

/**
 * Profiles for the surviving candidates — eligible users only, each carrying
 * the `show_activity` flag as a boolean computed the same way `PRIVACY_FILTER`
 * computes it (a jsonb `false`, compared as text).
 */
async function fetchProfiles(db: LfgDb, ids: number[]): Promise<Profile[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      userId: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarUrl: sql<
        string | null
      >`COALESCE(${schema.users.customAvatarUrl}, ${schema.users.avatar})`,
      optedOut: sql<boolean>`COALESCE((${schema.userPreferences.value})::text = 'false', false)`,
    })
    .from(schema.users)
    .leftJoin(
      schema.userPreferences,
      and(
        eq(schema.userPreferences.userId, schema.users.id),
        eq(schema.userPreferences.key, 'show_activity'),
      ),
    )
    .where(and(inArray(schema.users.id, ids), eligibleUser()));
}

/**
 * Project a candidate onto the wire DTO, honouring the privacy flag.
 *
 * `show_activity=false` suppresses ONLY the activity-derived facts — the
 * `played` reason and `lastPlayedAt`. A user who opted out of activity sharing
 * still shows up for `owns` / `hearted`, which they published deliberately.
 *
 * @returns The DTO, or null when privacy removed the user's only reason.
 */
function toSuggestion(
  profile: Profile,
  candidate: Candidate,
): LfgSuggestionDto | null {
  const reasons = REASON_ORDER.filter(
    (r) => candidate.reasons.has(r) && !(profile.optedOut && r === 'played'),
  );
  if (reasons.length === 0) return null;
  const lastPlayedAt = profile.optedOut ? null : candidate.lastPlayedAt;
  return {
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    reasons,
    lastPlayedAt: lastPlayedAt?.toISOString() ?? null,
  };
}

/** Most reasons first, then most recently played, then username. */
function rank(suggestions: LfgSuggestionDto[]): LfgSuggestionDto[] {
  const played = (s: LfgSuggestionDto): number =>
    s.lastPlayedAt ? Date.parse(s.lastPlayedAt) : 0;
  return [...suggestions].sort(
    (l, r) =>
      r.reasons.length - l.reasons.length ||
      played(r) - played(l) ||
      l.username.localeCompare(r.username),
  );
}

/**
 * `GET /lfg/:gameId/suggestions` — players who might want in on this group.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game the group is for.
 * @param viewerId - Caller, who is never suggested to themselves.
 * @returns Ranked suggestions, capped at {@link LFG_SUGGESTIONS_LIMIT}.
 */
export async function listSuggestions(
  db: LfgDb,
  gameId: number,
  viewerId: number,
): Promise<LfgSuggestionDto[]> {
  const [played, interests, holders] = await Promise.all([
    fetchPlayedForGame(db, gameId, LFG_SUGGESTIONS_PLAYED_DAYS),
    fetchInterests(db, gameId),
    fetchLiveHolders(db, gameId),
  ]);
  const candidates = collectCandidates(played, interests);
  for (const userId of [...candidates.keys()]) {
    if (userId === viewerId || holders.has(userId)) candidates.delete(userId);
  }
  const profiles = await fetchProfiles(db, [...candidates.keys()]);
  const suggestions = profiles
    .map((p) => toSuggestion(p, candidates.get(p.userId)!))
    .filter((s): s is LfgSuggestionDto => s !== null);
  return rank(suggestions).slice(0, LFG_SUGGESTIONS_LIMIT);
}
