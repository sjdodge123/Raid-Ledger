/**
 * ROK-1444 — the monotonic nomination cap (the target's DENOMINATOR).
 *
 * `nominationCap(n) = max(20, n * 5)` where n is the number of DISTINCT
 * nominators. That count can fall as well as rise: removing a nominator's last
 * entry drops n, which collapses the cap and raises the filled percentage
 * without anyone nominating anything. With a percentage-based early-advance
 * target that meant a DELETION could open voting — verified end to end before
 * this module existed (21/25 = 84% became 20/20 = 100% on one removal).
 *
 * So the cap is ratcheted: `community_lineups.nomination_cap_peak` records the
 * highest cap the lineup has ever had, and the effective cap is the greater of
 * the live value and that peak. It only ever goes up.
 *
 * Two consequences, both wanted:
 *   - A removal can never raise the filled percentage, so it can never trigger
 *     an advance.
 *   - The denominator shown to players stops jittering, which is what makes it
 *     safe to publish (people are nominating toward a fixed bar).
 *
 * The same effective cap backs `validateNominationCap`'s rejection ceiling.
 * These must not diverge: a live ceiling with a peaked target denominator would
 * reject nominations at 20/20 while the target still read 80% of 25, deadlocking
 * the lineup until its deadline.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { countDistinctNominators } from './lineups-query.helpers';
import { nominationCap } from './common-ground-scoring.constants';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** Effective cap for a lineup: the live cap floored at its recorded peak. */
export function effectiveNominationCap(
  distinctNominators: number,
  peak: number | null | undefined,
): number {
  return Math.max(nominationCap(distinctNominators), peak ?? 0);
}

/**
 * Read-only effective cap. Use on query paths (detail response, predicates)
 * where a write would be inappropriate.
 */
export async function loadEffectiveNominationCap(
  db: Db,
  lineup: LineupRow,
): Promise<number> {
  const [nominators] = await countDistinctNominators(db, lineup.id);
  return effectiveNominationCap(
    nominators?.count ?? 0,
    lineup.nominationCapPeak,
  );
}

/**
 * Effective cap for callers that hold only a lineup id (milestone embeds, the
 * Common Ground meta). Reads the stored peak itself so every surface that
 * publishes or gates on a cap agrees with `validateNominationCap`.
 */
export async function loadEffectiveNominationCapById(
  db: Db,
  lineupId: number,
): Promise<number> {
  const [row] = await db
    .select({ peak: schema.communityLineups.nominationCapPeak })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId));
  const [nominators] = await countDistinctNominators(db, lineupId);
  return effectiveNominationCap(nominators?.count ?? 0, row?.peak);
}

/**
 * Ratchet the stored peak up to the current live cap and return the effective
 * value. Called after an entry is ADDED — the only direction that can raise the
 * distinct-nominator count. `GREATEST` in SQL keeps concurrent nominators from
 * clobbering each other's ratchet.
 */
export async function ratchetNominationCap(
  db: Db,
  lineupId: number,
): Promise<number> {
  const [nominators] = await countDistinctNominators(db, lineupId);
  const live = nominationCap(nominators?.count ?? 0);
  const [row] = await db
    .update(schema.communityLineups)
    .set({
      nominationCapPeak: sql`GREATEST(COALESCE(${schema.communityLineups.nominationCapPeak}, 0), ${live})`,
    })
    .where(eq(schema.communityLineups.id, lineupId))
    .returning({ peak: schema.communityLineups.nominationCapPeak });
  return row?.peak ?? live;
}
