/**
 * DEMO_MODE-only fixtures for the Co-Optimus co-op section smoke tests
 * (ROK-1398). Pure functions over a passed-in db handle, mirroring
 * `demo-test-steam.helpers.ts`.
 *
 * Seeds three deterministic games covering the section's UI states:
 *   enriched     — synced with a full set of co-op facts + attribution url
 *   synced-empty — synced, but Co-Optimus has no co-op entry for it
 *   unsynced     — never synced (the section must not render at all)
 *
 * Idempotent: reruns upsert the same three rows. INSERTs go through the
 * normalized-name dedup guard (CLAUDE.md) because `ON CONFLICT (igdb_id)` does
 * not fire for the NULL igdb_id these fixtures carry.
 *
 * The Co-Optimus HTTP user-agent is deliberately never referenced here.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type GameValues = Partial<typeof schema.games.$inferInsert>;

/** Attribution target for the enriched fixture. */
export const COOPTIMUS_FIXTURE_URL =
  'https://www.co-optimus.com/game/4471/pc/deep-rock-galactic.html';

/** Result shape the smoke spec's `beforeAll` depends on. */
export interface CooptimusSeedResult {
  enrichedGameId: number;
  syncedEmptyGameId: number;
  unsyncedGameId: number;
  cooptimusUrl: string;
}

/** Every Co-Optimus column, blanked — the baseline each fixture overrides. */
const CLEARED_COOP: GameValues = {
  cooptimusId: null,
  cooptimusOnlineMax: null,
  cooptimusCouchMax: null,
  cooptimusLanMax: null,
  cooptimusSplitscreen: null,
  cooptimusDropIn: null,
  cooptimusCampaignCoop: null,
  cooptimusComboCoop: null,
  cooptimusUrl: null,
  cooptimusExtras: null,
  cooptimusSyncedAt: null,
};

const ENRICHED: GameValues = {
  cooptimusId: 4471,
  cooptimusOnlineMax: 4,
  cooptimusCouchMax: 2,
  cooptimusLanMax: 4,
  cooptimusSplitscreen: true,
  cooptimusDropIn: true,
  cooptimusCampaignCoop: true,
  cooptimusComboCoop: true,
  cooptimusUrl: COOPTIMUS_FIXTURE_URL,
  cooptimusExtras: {
    system: 'PC',
    featurelist: 'Online Co-Op,Local Co-Op,Downloadable Only',
    downloadableOnly: true,
    coopExperience: 'Four dwarves dig, shoot, and lose the drop pod together.',
    description: 'A co-op first-person shooter about dwarves mining in space.',
  },
};

/**
 * Upsert one fixture game by canonical name and return its id.
 * Matches on the normalized name first so repeat runs update rather than
 * duplicate; every Co-Optimus column is reset before the fixture's values are
 * applied, so a rerun cannot inherit a previous fixture's state.
 */
async function upsertFixtureGame(
  db: Db,
  name: string,
  slug: string,
  coop: GameValues,
): Promise<number> {
  const values = { ...CLEARED_COOP, ...coop };
  const existing = await findGameByNormalizedName(db, name);
  if (existing) {
    await db
      .update(schema.games)
      .set({ ...values, hidden: false, banned: false })
      .where(eq(schema.games.id, existing.id));
    return existing.id;
  }
  const [created] = await db
    .insert(schema.games)
    .values({
      name,
      slug,
      summary: 'Smoke-test fixture for the Co-Optimus co-op section.',
      ...values,
    })
    .returning({ id: schema.games.id });
  return created.id;
}

/** Seed the three co-op UI-state fixtures (ROK-1398 smoke). */
export async function seedCooptimusFixtures(
  db: Db,
): Promise<CooptimusSeedResult> {
  const syncedAt = new Date();
  const enrichedGameId = await upsertFixtureGame(
    db,
    'ROK-1398 Co-Op Enriched Fixture',
    'rok-1398-coop-enriched-fixture',
    { ...ENRICHED, cooptimusSyncedAt: syncedAt },
  );
  const syncedEmptyGameId = await upsertFixtureGame(
    db,
    'ROK-1398 Co-Op Empty Fixture',
    'rok-1398-coop-empty-fixture',
    { cooptimusSyncedAt: syncedAt },
  );
  const unsyncedGameId = await upsertFixtureGame(
    db,
    'ROK-1398 Co-Op Unsynced Fixture',
    'rok-1398-coop-unsynced-fixture',
    {},
  );
  return {
    enrichedGameId,
    syncedEmptyGameId,
    unsyncedGameId,
    cooptimusUrl: COOPTIMUS_FIXTURE_URL,
  };
}
