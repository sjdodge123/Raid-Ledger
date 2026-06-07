import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  findLiveRLEventsForDedup,
  type LiveRLEventMatch,
} from './scheduled-event.db-helpers';

/**
 * Minimal shape of a Discord guild scheduled event used by GC's
 * duplicate-reclassification pass (ROK-1347). discord.js exposes `name` and
 * `scheduledStartTimestamp` (ms epoch); a plain `{ id, name,
 * scheduledStartTimestamp }` is enough for tests.
 */
export interface GuildSEShape {
  id: string;
  name?: string | null;
  scheduledStartTimestamp?: number | null;
  scheduledStartAt?: Date | null;
  description?: string | null;
}

/**
 * RL fingerprint check (Codex P2, fix/batch-2026-06-06): RL-created SEs carry
 * `View event: {clientUrl}/events/{eventId}` in their description
 * (`buildDescriptionText`). Title+start alone can collide with an
 * operator-created SE — adopting or deleting on that match alone would let RL
 * hijack/destroy an operator's event. Requiring the `/events/<id>` URL (digit
 * boundary so 16 ≠ 161) restricts adopt/reclaim to SEs RL itself created.
 * Installs without CLIENT_URL configured never produce the fingerprint, so
 * they degrade to pre-ROK-1347 behavior (no adopt, no reclaim) — safe.
 */
export function hasRLFingerprint(
  se: Pick<GuildSEShape, 'description'>,
  eventId: number,
): boolean {
  const desc = se.description ?? '';
  return new RegExp(`/events/${eventId}(?!\\d)`).test(desc);
}

/**
 * Match key for an SE: normalized name + scheduled-start epoch (ms). Both the
 * guild SE and the RL event row collapse to the same key when they describe the
 * same event, so an untracked guild SE can be recognised as an RL-created
 * duplicate of a live event row (ROK-1347).
 */
export function seMatchKey(name: string, startMs: number): string {
  return `${name.trim().toLowerCase()}\u0000${startMs}`;
}

export function guildSEStartMs(se: GuildSEShape): number | null {
  if (typeof se.scheduledStartTimestamp === 'number')
    return se.scheduledStartTimestamp;
  if (se.scheduledStartAt instanceof Date) return se.scheduledStartAt.getTime();
  return null;
}

/**
 * Find an existing guild SE matching the given name + start (ISO). Used by the
 * idempotent create path: a pre-create liveness check and a timeout-after-
 * success confirmation fetch both need to know if Discord already holds an SE
 * for this RL event before creating a (duplicate) one (ROK-1347).
 */
export function findExistingGuildSE(
  guildSEs: Iterable<GuildSEShape>,
  name: string,
  startIso: string,
): GuildSEShape | null {
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return null;
  const wantKey = seMatchKey(name, startMs);
  for (const se of guildSEs) {
    const seStart = guildSEStartMs(se);
    if (seStart == null) continue;
    if (seMatchKey(se.name ?? '', seStart) === wantKey) return se;
  }
  return null;
}

interface LiveEventIndexEntry {
  eventId: number;
  boundSeId: string | null;
  /** Two live events collided on the same title+start key — never delete. */
  ambiguous?: boolean;
}

/** Build a lookup of live RL events by SE match key, recording the SE id each
 *  event is currently bound to (so we never delete the bound copy).
 *
 *  `row.title` is raw DB casing — `seMatchKey` lowercases internally so both
 *  sides normalise identically. Two live events sharing title+start collide on
 *  one key; the entry is marked `ambiguous` so the classifier treats matching
 *  SEs as operator orphans (never delete on ambiguity) instead of silently
 *  letting the last row win. */
function indexLiveEvents(
  rows: LiveRLEventMatch[],
): Map<string, LiveEventIndexEntry> {
  const index = new Map<string, LiveEventIndexEntry>();
  for (const row of rows) {
    const startMs = new Date(row.startIso).getTime();
    if (Number.isNaN(startMs)) continue;
    const key = seMatchKey(row.title, startMs);
    if (index.has(key)) {
      index.set(key, { eventId: row.id, boundSeId: null, ambiguous: true });
      continue;
    }
    index.set(key, {
      eventId: row.id,
      boundSeId: row.discordScheduledEventId,
    });
  }
  return index;
}

/** A guild SE that matches a live RL event but is NOT the bound copy — an
 *  RL-created stale duplicate GC can safely delete (ROK-1347). */
export interface ReclaimableDuplicate {
  eventId: number;
  seId: string;
}

/**
 * Of the guild SEs NOT tracked in `discord_scheduled_event_id` (the "orphans"),
 * separate the RL-created duplicates (same name+start as a live RL event that
 * already has a DIFFERENT bound SE id) from genuine operator-owned SEs.
 *
 * Returns `{ reclaimable, operatorOrphanCount }`. Operator orphans are never
 * deleted; reclaimable duplicates are the actual free path for the 80-orphan
 * production freeze.
 */
export async function classifyUntrackedSEs(
  db: PostgresJsDatabase<typeof schema>,
  untracked: GuildSEShape[],
): Promise<{
  reclaimable: ReclaimableDuplicate[];
  operatorOrphanCount: number;
}> {
  if (untracked.length === 0)
    return { reclaimable: [], operatorOrphanCount: 0 };

  const liveRows = await findLiveRLEventsForDedup(db);
  const index = indexLiveEvents(liveRows);

  const reclaimable: ReclaimableDuplicate[] = [];
  let operatorOrphanCount = 0;

  for (const se of untracked) {
    const startMs = guildSEStartMs(se);
    const name = se.name ?? '';
    const match =
      startMs != null ? index.get(seMatchKey(name, startMs)) : undefined;
    // RL duplicate only when a live event matches AND that event is bound to
    // a DIFFERENT SE. boundSeId === null means the event has no SE yet
    // (creation in-flight / first reconcile tick) — a matching guild SE could
    // be a legitimate operator event and must NOT be deleted (review critical,
    // fix/batch-2026-06-06). Ambiguous title+start collisions likewise. If
    // boundSeId === se.id it's tracked elsewhere — guard anyway. The SE must
    // ALSO carry RL's description fingerprint — title+start can collide with
    // an operator-created SE, which GC must never delete (Codex P2).
    if (
      match &&
      !match.ambiguous &&
      match.boundSeId !== null &&
      match.boundSeId !== se.id &&
      hasRLFingerprint(se, match.eventId)
    ) {
      reclaimable.push({ eventId: match.eventId, seId: se.id });
    } else {
      operatorOrphanCount++;
    }
  }

  return { reclaimable, operatorOrphanCount };
}
