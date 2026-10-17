/**
 * Helpers for determining dominant game variant/region from event signups.
 */
import { eq, and, not } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Finds the key with the highest count in a Map. */
function findDominant(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let max = 0;
  for (const [key, count] of counts) {
    if (count > max) {
      best = key;
      max = count;
    }
  }
  return best;
}

/** Tallies variant and region occurrences from signup rows. */
function tallyCounts(
  rows: { gameVariant: string | null; region: string | null }[],
): { variants: Map<string, number>; regions: Map<string, number> } {
  const variants = new Map<string, number>();
  const regions = new Map<string, number>();
  for (const row of rows) {
    if (row.gameVariant) {
      variants.set(row.gameVariant, (variants.get(row.gameVariant) ?? 0) + 1);
    }
    if (row.region) {
      regions.set(row.region, (regions.get(row.region) ?? 0) + 1);
    }
  }
  return { variants, regions };
}

/** Gets the dominant game variant and region for an event's signups. */
export async function getVariantContext(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<{ gameVariant: string | null; region: string | null }> {
  const rows = await db
    .select({
      gameVariant: schema.characters.gameVariant,
      region: schema.characters.region,
    })
    .from(schema.eventSignups)
    .innerJoin(
      schema.characters,
      eq(schema.eventSignups.characterId, schema.characters.id),
    )
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        not(eq(schema.eventSignups.status, 'declined')),
        not(eq(schema.eventSignups.status, 'roached_out')),
        not(eq(schema.eventSignups.status, 'departed')),
      ),
    );
  if (rows.length === 0) return { gameVariant: null, region: null };
  const { variants, regions } = tallyCounts(rows);
  return { gameVariant: findDominant(variants), region: findDominant(regions) };
}
