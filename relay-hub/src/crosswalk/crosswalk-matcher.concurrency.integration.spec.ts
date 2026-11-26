import { normalizeForDedup } from '@raid-ledger/contract';
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { performance } from 'perf_hooks';
import postgres, { type Sql } from 'postgres';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import {
  gamesNamed,
  must,
  only,
  seedApprovedInstance,
  testItem,
} from '../test/crosswalk-test-kit';
import { createTestDatabase, type TestDatabase } from '../test/test-database';
import { CrosswalkLock } from './crosswalk-lock';
import { CrosswalkMatcherService } from './crosswalk-matcher.service';

const INSTANCE = '6f6f6f6f-6666-4666-8666-666666666666';
const ITERATIONS = 20;
/** AC 8: a 100-item batch of new games finishes in < 2 s on CI Postgres. */
const PERF_BUDGET_MS = 2_000;

// Top-level hooks + tests: one file-wide DB (ROK-1670 L10).
let db: TestDatabase;
let sql: Sql;
let clients: Sql[] = [];
let left: CrosswalkMatcherService;
let right: CrosswalkMatcherService;

/** A matcher on its own single-connection client (AC 7: separate sessions). */
function matcherOnOwnConnection(url: string): CrosswalkMatcherService {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  clients.push(client);
  const lock = new CrosswalkLock(drizzle(client, { schema }));
  return new CrosswalkMatcherService(lock);
}

beforeAll(async () => {
  db = await createTestDatabase();
  await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
  sql = postgres(db.url, { max: 2, onnotice: () => undefined });
  left = matcherOnOwnConnection(db.url);
  right = matcherOnOwnConnection(db.url);
  const seeder = postgres(db.url, { max: 1, onnotice: () => undefined });
  await seedApprovedInstance(drizzle(seeder, { schema }), INSTANCE);
  await seeder.end({ timeout: 5 });
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end({ timeout: 5 })));
  clients = [];
  await sql.end({ timeout: 5 });
  await db.drop();
});

let nextId = 500_000;
const uniq = (): number => (nextId += 1);
/** Who owns `kind:value` (every owner row; the PK allows at most one). */
const ownersOf = async (kind: string, value: string): Promise<string[]> =>
  (
    await sql<{ g: string }[]>`SELECT rl_game_id AS g FROM hub_game_ids
      WHERE kind = ${kind} AND value = ${value}`
  ).map((r) => r.g);
const idCount = async (rlGameId: string): Promise<number> =>
  must(
    (
      await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM hub_game_ids
        WHERE rl_game_id = ${rlGameId}`
    )[0],
    'id count',
  ).n;

it(`AC7: the same new game posted on two connections at once → one game (${ITERATIONS}x)`, async () => {
  for (let i = 0; i < ITERATIONS; i += 1) {
    const name = `Race Game ${i}`;
    const item = testItem(name, { steam: uniq(), itad: randomUUID() });
    const [a, b] = await Promise.all([
      left.matchBatch(INSTANCE, [item]),
      right.matchBatch(INSTANCE, [item]),
    ]);
    const ra = only(a);
    const rb = only(b);
    expect(rb.rlGameId).toBe(ra.rlGameId);
    expect([ra.result, rb.result].sort()).toEqual(['created', 'matched']);
    expect(await gamesNamed(sql, normalizeForDedup(name))).toBe(1);
    expect(await idCount(ra.rlGameId)).toBe(2);
  }
});

it(`AC7: overlapping ids in opposite item order → no duplicate game or row (${ITERATIONS}x)`, async () => {
  for (let i = 0; i < ITERATIONS; i += 1) {
    const steam = uniq();
    const igdb = uniq();
    const itad = randomUUID();
    const s = testItem(`Overlap Steam ${i}`, { steam });
    const g = testItem(`Overlap Igdb ${i}`, { igdb });
    const g2 = testItem(`Overlap Igdb ${i}`, { igdb, itad });
    await Promise.all([
      left.matchBatch(INSTANCE, [s, g]),
      right.matchBatch(INSTANCE, [g2, s]),
    ]);
    expect(await ownersOf('steam_app_id', String(steam))).toHaveLength(1);
    const igdbOwners = await ownersOf('igdb_id', String(igdb));
    expect(igdbOwners).toHaveLength(1);
    expect(await ownersOf('itad_uuid', itad)).toEqual(igdbOwners);
    expect(await gamesNamed(sql, normalizeForDedup(`Overlap Steam ${i}`))).toBe(
      1,
    );
    expect(await gamesNamed(sql, normalizeForDedup(`Overlap Igdb ${i}`))).toBe(
      1,
    );
  }
});

it(`AC7: same name, different ids at once → the name lock yields one game (${ITERATIONS}x)`, async () => {
  for (let i = 0; i < ITERATIONS; i += 1) {
    const name = `Shared Name ${i}`;
    const [a, b] = await Promise.all([
      left.matchBatch(INSTANCE, [testItem(name, { steam: uniq() })]),
      right.matchBatch(INSTANCE, [testItem(name, { igdb: uniq() })]),
    ]);
    const ra = only(a);
    const rb = only(b);
    expect(rb.rlGameId).toBe(ra.rlGameId);
    expect([ra.result, rb.result].sort()).toEqual(['attached', 'created']);
    expect(await gamesNamed(sql, normalizeForDedup(name))).toBe(1);
    expect(await idCount(ra.rlGameId)).toBe(2);
  }
});

it('AC8: a 100-item batch of new games completes within the budget', async () => {
  // Warm-up: connection set-up is not part of the measured batch.
  await left.matchBatch(INSTANCE, [testItem('Perf Warmup', { steam: uniq() })]);
  const items = Array.from({ length: 100 }, (_, i) =>
    testItem(`Perf Game ${i}`, { steam: uniq(), igdb: uniq() }),
  );
  const started = performance.now();
  const results = await left.matchBatch(INSTANCE, items);
  const elapsed = performance.now() - started;
  process.stdout.write(
    `[ROK-1673 AC8] 100 new games matched in ${elapsed.toFixed(0)} ms (assert < ${PERF_BUDGET_MS})\n`,
  );
  expect(results.map((r) => r.result)).toEqual(Array(100).fill('created'));
  expect(new Set(results.map((r) => r.rlGameId)).size).toBe(100);
  expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
});
