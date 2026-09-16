/**
 * DEMO_MODE-only player-count fixtures for the Library filter smoke spec
 * (ROK-1525). Pure functions over a passed-in db handle, mirroring
 * `demo-test-cooptimus.helpers.ts`.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `library-filters.smoke.spec.ts` used to DERIVE its fixtures from whatever
 * `GET /games/discover` happened to return, and fail loudly when no preset
 * both kept and dropped a card. That holds on an IGDB-enriched corpus (the
 * fleet env, 803/0) and does NOT hold on GitHub CI's seeded DB, which carries
 * no player-count variety at all — `player_count` is NULL on every row, so
 * every preset drops everything and the corpus cannot prove a narrowing. The
 * spec was therefore green or red by environment, which is not a test.
 *
 * So the spec seeds its own evidence: exactly two games with EXPLICIT ranges,
 * one that every preset keeps and one that every preset drops, on any env.
 *
 * ─── AND WHY A DYNAMIC CATEGORY CARRIES THEM ────────────────────────────────
 * Being in `games` is not enough to be in `/games/discover`. Every static row
 * is either Redis-cached (`fetchCategoryRow`, so a row cached before the seed
 * would hide the fixtures for the whole TTL) or ranked by a corpus-relative
 * metric (`Most Wishlisted`/`Your Community Wants to Play` take the top 20 by
 * interest count — a two-row fixture is not guaranteed a slot). An approved,
 * non-expired `fixed`-strategy discovery category is neither: it is loaded
 * uncached on every request by `loadApprovedDynamicRows` and hydrates exactly
 * the candidate ids it was given, so the fixtures are present by construction.
 *
 * Idempotent: reruns upsert the same two games and the same category row,
 * because the desktop and mobile Playwright projects both run this spec's
 * `beforeAll` against one shared DB.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { withGameNameLock } from '../igdb/games-name-lock.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Result shape the smoke spec's `beforeAll` depends on. */
export interface PlayerCountSeedResult {
  /** `1-1` — dropped by every preset (2 / 3 / 4 / 5+). */
  soloGameId: number;
  soloName: string;
  /** `2-5` — kept by every preset. */
  partyGameId: number;
  partyName: string;
  /** The discovery category row carrying both into `/games/discover`. */
  categoryId: string;
}

const SOLO_NAME = 'ROK-1525 Solo Player Fixture';
const SOLO_SLUG = 'rok-1525-solo-player-fixture';
const PARTY_NAME = 'ROK-1525 Party Player Fixture';
const PARTY_SLUG = 'rok-1525-party-player-fixture';
const CATEGORY_NAME = 'ROK-1525 Player Count Fixtures';

/** The two ranges the spec's kept/dropped pair is built from. */
const SOLO_RANGE = { min: 1, max: 1 } as const;
const PARTY_RANGE = { min: 2, max: 5 } as const;

/**
 * The axis order is `[co_op, pvp, rpg, survival, strategy, social, mmo]`. The
 * `fixed` strategy never runs a cosine query, so this is only here because the
 * column is NOT NULL — it is not a claim about the fixtures.
 */
const FIXTURE_THEME_VECTOR: readonly number[] = [0.5, 0, 0.3, 0, 0.2, 0.4, 0];

/**
 * Sorted behind any real curated row (dynamic rows are ordered by
 * `sort_order`), so a fixture row cannot displace a category another spec
 * seeded from the top of its own list.
 */
const FIXTURE_SORT_ORDER = 9_000;

/**
 * Upsert one fixture game by canonical name and return its id.
 *
 * ROK-1438 (CLAUDE.md STRICT): the find-then-insert runs inside
 * `withGameNameLock` on the normalized name, because `ON CONFLICT (igdb_id)`
 * does not fire for the NULL `igdb_id` these fixtures carry and the two
 * Playwright projects can otherwise both miss the lookup and both insert.
 */
async function upsertFixtureGame(
  db: Db,
  name: string,
  slug: string,
  playerCount: { min: number; max: number },
): Promise<number> {
  return withGameNameLock(db, name, (tx) =>
    upsertFixtureGameLocked(tx, name, slug, playerCount),
  );
}

/** Find-then-insert body. MUST run inside the name lock. */
async function upsertFixtureGameLocked(
  db: Db,
  name: string,
  slug: string,
  playerCount: { min: number; max: number },
): Promise<number> {
  const values = { playerCount, hidden: false, banned: false };
  const existing = await findGameByNormalizedName(db, name);
  if (existing) {
    await db
      .update(schema.games)
      .set(values)
      .where(eq(schema.games.id, existing.id));
    return existing.id;
  }
  // `slug` is UNIQUE and the advisory lock is keyed on the NAME, so a row this
  // fixture already created under a different name normalization must update
  // rather than 500 its caller.
  const [created] = await db
    .insert(schema.games)
    .values({
      name,
      slug,
      summary: 'Smoke-test fixture for the Library player-count filters.',
      ...values,
    })
    .onConflictDoUpdate({ target: schema.games.slug, set: values })
    .returning({ id: schema.games.id });
  return created.id;
}

/**
 * Upsert the approved `fixed` category that carries both fixtures into
 * `/games/discover`. Matched by name so repeat runs (and the second
 * Playwright project) reuse the row instead of stacking duplicates.
 */
async function upsertFixtureCategory(
  db: Db,
  candidateGameIds: number[],
): Promise<string> {
  const values = {
    status: 'approved',
    populationStrategy: 'fixed',
    candidateGameIds,
    expiresAt: null,
    sortOrder: FIXTURE_SORT_ORDER,
  };
  const [existing] = await db
    .select({ id: schema.discoveryCategorySuggestions.id })
    .from(schema.discoveryCategorySuggestions)
    .where(eq(schema.discoveryCategorySuggestions.name, CATEGORY_NAME))
    .limit(1);
  if (!existing) return insertFixtureCategory(db, values);
  await db
    .update(schema.discoveryCategorySuggestions)
    .set(values)
    .where(eq(schema.discoveryCategorySuggestions.id, existing.id));
  return existing.id;
}

/** The insert half of `upsertFixtureCategory`. */
async function insertFixtureCategory(
  db: Db,
  values: Record<string, unknown>,
): Promise<string> {
  const [created] = await db
    .insert(schema.discoveryCategorySuggestions)
    .values({
      name: CATEGORY_NAME,
      description:
        'Seeded by the ROK-1525 Library-filter smoke spec — two games with ' +
        'explicit player-count ranges, so the preset chips have something to ' +
        'narrow on any environment.',
      categoryType: 'trend',
      themeVector: [...FIXTURE_THEME_VECTOR],
      ...values,
    } as typeof schema.discoveryCategorySuggestions.$inferInsert)
    .returning({ id: schema.discoveryCategorySuggestions.id });
  return created.id;
}

/** Seed the two player-count fixtures + their discover row (ROK-1525 smoke). */
export async function seedPlayerCountFixtures(
  db: Db,
): Promise<PlayerCountSeedResult> {
  const soloGameId = await upsertFixtureGame(
    db,
    SOLO_NAME,
    SOLO_SLUG,
    SOLO_RANGE,
  );
  const partyGameId = await upsertFixtureGame(
    db,
    PARTY_NAME,
    PARTY_SLUG,
    PARTY_RANGE,
  );
  const categoryId = await upsertFixtureCategory(db, [partyGameId, soloGameId]);
  return {
    soloGameId,
    soloName: SOLO_NAME,
    partyGameId,
    partyName: PARTY_NAME,
    categoryId,
  };
}
