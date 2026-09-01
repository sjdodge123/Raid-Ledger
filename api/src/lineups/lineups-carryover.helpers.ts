/**
 * Auto-carryover helpers for community lineups (ROK-937).
 * Copies suggested match entries from a previous lineup to a new one.
 */
import { and, desc, eq, ne, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ratchetNominationCap } from './lineups-nomination-cap.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const CARRYOVER_STATUSES = ['decided', 'archived'] as const;

/**
 * Find the most recent PUBLIC lineup in decided or archived status (ROK-1065).
 * Private lineups never contribute to carryover — their invitee-scoped
 * suggestion history is intentionally isolated from public rollover.
 */
async function findPreviousLineup(db: Db, excludeId: number) {
  return db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(
      and(
        ne(schema.communityLineups.id, excludeId),
        inArray(schema.communityLineups.status, [...CARRYOVER_STATUSES]),
        eq(schema.communityLineups.visibility, 'public'),
      ),
    )
    .orderBy(desc(schema.communityLineups.createdAt))
    .limit(1);
}

/**
 * Find below-threshold suggested matches for a lineup (the "didn't make it"
 * games eligible for another shot next cycle).
 *
 * ROK-1302: filter on `thresholdMet=false`. For a scheduling-opted-out lineup,
 * threshold-clearing WINNERS are stored as `suggested` (instead of
 * `scheduling`) but carry `thresholdMet=true` — those are terminal results and
 * must NOT roll over. Scheduling-enabled lineups are unaffected: their
 * threshold-met matches are `scheduling` (never selected here), and their
 * below-threshold matches are `suggested` + `thresholdMet=false` (still
 * carried over as before).
 */
async function findSuggestedMatches(db: Db, lineupId: number) {
  return db
    .select({
      gameId: schema.communityLineupMatches.gameId,
      voteCount: schema.communityLineupMatches.voteCount,
    })
    .from(schema.communityLineupMatches)
    .where(
      and(
        eq(schema.communityLineupMatches.lineupId, lineupId),
        eq(schema.communityLineupMatches.status, 'suggested'),
        eq(schema.communityLineupMatches.thresholdMet, false),
      ),
    );
}

/** Find the original nominator for a game in a lineup. */
async function findOriginalNominator(db: Db, lineupId: number, gameId: number) {
  return db
    .select({ nominatedBy: schema.communityLineupEntries.nominatedBy })
    .from(schema.communityLineupEntries)
    .where(
      and(
        eq(schema.communityLineupEntries.lineupId, lineupId),
        eq(schema.communityLineupEntries.gameId, gameId),
      ),
    )
    .limit(1);
}

/** Insert a carried-over entry into the new lineup. */
async function insertCarriedEntry(
  db: Db,
  newLineupId: number,
  gameId: number,
  nominatedBy: number,
  oldLineupId: number,
) {
  await db.insert(schema.communityLineupEntries).values({
    lineupId: newLineupId,
    gameId,
    nominatedBy,
    carriedOverFrom: oldLineupId,
  });
}

/**
 * Carry over suggested match entries from the most recent
 * decided/archived lineup into a new lineup.
 */
export async function carryOverFromLastDecided(
  db: Db,
  newLineupId: number,
): Promise<void> {
  const [prev] = await findPreviousLineup(db, newLineupId);
  if (!prev) return;

  const suggestedMatches = await findSuggestedMatches(db, prev.id);
  if (suggestedMatches.length === 0) return;

  let carried = 0;
  for (const match of suggestedMatches) {
    const [entry] = await findOriginalNominator(db, prev.id, match.gameId);
    if (!entry?.nominatedBy) continue; // skip if nominator was deleted
    await insertCarriedEntry(
      db,
      newLineupId,
      match.gameId,
      entry.nominatedBy,
      prev.id,
    );
    carried++;
  }
  // ROK-1444 (Codex P2): pin `nomination_cap_peak` for the carried-over roster
  // REGARDLESS of whether an early-advance target is configured. Carry-over is
  // the only path that can seed a lineup with several distinct nominators
  // before anyone nominates through `runNominate` (which is where the ratchet
  // normally fires), so without this a deadline-only lineup could start at
  // 21/25, lose its fifth nominator's only entry, and collapse to a live cap of
  // 20 — rendering as full at 20/20 with every nominate button disabled.
  // A lineup with no carried entries needs no pin: its cap is the base 20,
  // which is already the floor and cannot shrink.
  if (carried > 0) await ratchetNominationCap(db, newLineupId);
}
