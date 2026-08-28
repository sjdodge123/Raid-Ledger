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
import { withGameNameLock } from '../igdb/games-name-lock.helpers';

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

/**
 * ROK-1401: the enriched fixture also needs to be reachable from the Common
 * Ground picker, whose base predicate is
 * `(g.steam_app_id IS NOT NULL OR g.igdb_id IS NOT NULL)` — a name+slug-only
 * fixture is invisible there, so the co-op-pill smoke had nothing to assert
 * on. A sentinel `steam_app_id` is the minimal unlock: the column is NOT
 * unique (unlike `igdb_id`), so a fixed value cannot collide with a real
 * game's row, and nothing in DEMO_MODE syncs against it.
 */
const FIXTURE_STEAM_APP_ID = 13980001;

const ENRICHED: GameValues = {
  steamAppId: FIXTURE_STEAM_APP_ID,
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
  // ROK-1438: serialize the find-then-insert on the normalized name so the
  // concurrent Playwright workers noted below can't both miss the lookup.
  return withGameNameLock(db, name, (tx) =>
    upsertFixtureGameLocked(tx, name, slug, coop),
  );
}

/** Find-then-insert body. MUST run inside the name lock. */
async function upsertFixtureGameLocked(
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
  // Concurrent Playwright workers (desktop + mobile beforeAll) can both miss
  // the dedup lookup and race this INSERT; slug is UNIQUE, so make it
  // idempotent rather than letting the loser 500 (reviewer finding).
  const [created] = await db
    .insert(schema.games)
    .values({
      name,
      slug,
      summary: 'Smoke-test fixture for the Co-Optimus co-op section.',
      ...values,
    })
    .onConflictDoUpdate({
      target: schema.games.slug,
      set: { ...values, hidden: false, banned: false },
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
