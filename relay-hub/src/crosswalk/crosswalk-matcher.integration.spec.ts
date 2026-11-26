import { Test, type TestingModule } from '@nestjs/testing';
import { normalizeForDedup, RlGameIdSchema } from '@raid-ledger/contract';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import * as path from 'path';
import postgres, { type Sql } from 'postgres';
import {
  DrizzleModule,
  HUB_DB,
  HUB_SQL,
  type HubDb,
} from '../drizzle/drizzle.module';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import {
  gamesNamed,
  idRowsOf,
  maxSeq,
  must,
  only,
  seedApprovedInstance,
  seqOf,
  testItem,
  type TestIds,
  type TestProvenance,
} from '../test/crosswalk-test-kit';
import { createTestDatabase, type TestDatabase } from '../test/test-database';
import { CrosswalkMatcherService } from './crosswalk-matcher.service';
import { CrosswalkModule } from './crosswalk.module';

const INSTANCE = '5e5e5e5e-5555-4555-8555-555555555555';

// Top-level hooks + tests: one file-wide DB (ROK-1670 L10).
let db: TestDatabase;
let sql: Sql;
let moduleRef: TestingModule;
let matcher: CrosswalkMatcherService;

beforeAll(async () => {
  db = await createTestDatabase();
  await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
  sql = postgres(db.url, { max: 2, onnotice: () => undefined });
  // Resolved through CrosswalkModule's DI over the real DrizzleModule.
  moduleRef = await Test.createTestingModule({
    imports: [DrizzleModule, CrosswalkModule],
  })
    .overrideProvider(HUB_SQL)
    .useValue(postgres(db.url, { max: 2, onnotice: () => undefined }))
    .compile();
  matcher = moduleRef.get(CrosswalkMatcherService);
  await seedApprovedInstance(moduleRef.get<HubDb>(HUB_DB), INSTANCE);
});
afterAll(async () => {
  await moduleRef.close();
  await sql.end({ timeout: 5 });
  await db.drop();
});

// Every test owns its ids and names, so the file passes in any order.
let nextId = 100_000;
const uniq = (): number => (nextId += 1);
const post = async (name: string, ids: TestIds, prov?: TestProvenance) =>
  only(await matcher.matchBatch(INSTANCE, [testItem(name, ids, prov)]));
const conflictsOn = (value: string) =>
  sql<
    Record<string, unknown>[]
  >`SELECT kind, value, existing_rl_game_id AS existing,
      proposed_rl_game_id AS proposed, instance_id AS instance,
      jsonb_typeof(payload) AS shape, payload, resolved_at AS resolved
    FROM hub_crosswalk_conflicts WHERE value = ${value} ORDER BY id`;

describe('migration 0003', () => {
  it('is applied: every journal entry is recorded', async () => {
    const journal = journalLength();
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    expect(row?.n).toBe(journal);
    expect(journal).toBeGreaterThanOrEqual(4);
  });

  it('creates the three tables, their indexes and the updated_seq sequence', async () => {
    const seq = await sql`SELECT 1 FROM pg_class
      WHERE relkind = 'S' AND relname = 'hub_games_updated_seq'`;
    expect(seq).toHaveLength(1);
    const idx = await sql<{ i: string }[]>`SELECT indexname AS i FROM pg_indexes
      WHERE tablename IN ('hub_games', 'hub_game_ids', 'hub_crosswalk_conflicts')`;
    expect(idx.map((r) => r.i).sort()).toEqual([
      'hub_crosswalk_conflicts_open_idx',
      'hub_crosswalk_conflicts_pkey',
      'hub_game_ids_pkey',
      'hub_game_ids_rl_game_id_idx',
      'hub_games_normalized_name_idx',
      'hub_games_pkey',
      'hub_games_updated_seq_idx',
    ]);
    const [def] = await sql<{ d: string }[]>`SELECT column_default AS d
      FROM information_schema.columns
      WHERE table_name = 'hub_games' AND column_name = 'updated_seq'`;
    expect(def?.d).toContain("nextval('hub_games_updated_seq'");
  });
});

/** Number of entries in the hub migration journal. */
function journalLength(): number {
  const file = path.join(DEFAULT_MIGRATIONS_FOLDER, 'meta', '_journal.json');
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return -1;
  const entries: unknown = Reflect.get(parsed, 'entries');
  return Array.isArray(entries) ? entries.length : -1;
}

it('AC1: a new game is created with one row per id, provenance as sent', async () => {
  const steam = uniq();
  const igdb = uniq();
  const itad = randomUUID().toUpperCase();
  const name = 'Created: The Game';
  const r = await post(name, { steam, igdb, itad }, { igdb: 'unknown' });
  expect(r.result).toBe('created');
  expect(RlGameIdSchema.safeParse(r.rlGameId).success).toBe(true);
  const games = await sql`SELECT display_name, name_source, normalized_name
    FROM hub_games WHERE rl_game_id = ${r.rlGameId}`;
  expect(games).toEqual([
    {
      display_name: name,
      name_source: 'instance',
      normalized_name: normalizeForDedup(name),
    },
  ]);
  const base = { source: 'instance', instance: INSTANCE, count: 1 };
  expect(await idRowsOf(sql, r.rlGameId)).toEqual([
    { ...base, kind: 'igdb_id', value: String(igdb), provenance: 'unknown' },
    {
      ...base,
      kind: 'itad_uuid',
      value: itad.toLowerCase(),
      provenance: 'itad',
    },
    {
      ...base,
      kind: 'steam_app_id',
      value: String(steam),
      provenance: 'steam',
    },
  ]);
});

it('AC2: re-posting the identical batch matches, inserts nothing, bumps no seq', async () => {
  const items = [
    testItem('Repost One', { steam: uniq(), itad: randomUUID() }),
    testItem('Repost Two', { igdb: uniq() }),
  ];
  const first = await matcher.matchBatch(INSTANCE, items);
  expect(first.map((r) => r.result)).toEqual(['created', 'created']);
  const counts = () => sql`SELECT (SELECT count(*) FROM hub_games)::int AS g,
    (SELECT count(*) FROM hub_game_ids)::int AS i`;
  const before = { counts: await counts(), max: await maxSeq(sql) };
  const again = await matcher.matchBatch(INSTANCE, items);
  expect(again.map((r) => r.result)).toEqual(['matched', 'matched']);
  expect(again.map((r) => r.rlGameId)).toEqual(first.map((r) => r.rlGameId));
  expect({ counts: await counts(), max: await maxSeq(sql) }).toEqual(before);
});

it('AC3: the same Steam id plus a new ITAD UUID attaches and bumps the seq', async () => {
  const steam = uniq();
  const a = await post('Attach Target', { steam });
  const seqBefore = await seqOf(sql, a.rlGameId);
  const maxBefore = await maxSeq(sql);
  const itad = randomUUID();
  const r = await post('Attach Target', { steam, itad });
  expect(r).toEqual({ result: 'attached', rlGameId: a.rlGameId });
  expect((await idRowsOf(sql, a.rlGameId)).map((x) => x.kind)).toEqual([
    'itad_uuid',
    'steam_app_id',
  ]);
  const seqAfter = await seqOf(sql, a.rlGameId);
  expect(BigInt(seqAfter)).toBeGreaterThan(BigInt(seqBefore));
  expect(BigInt(await maxSeq(sql))).toBeGreaterThan(BigInt(maxBefore));
});

/** Game A owns a Steam id, game B an ITAD UUID (AC 4/6 setup). */
async function twoOwners(
  tag: string,
): Promise<{ steam: number; itad: string; a: string; b: string }> {
  const steam = uniq();
  const itad = randomUUID();
  const a = await post(`${tag} Alpha`, { steam });
  const b = await post(`${tag} Beta`, { itad });
  return { steam, itad, a: a.rlGameId, b: b.rlGameId };
}

it('AC4: ids owned by two games → one conflict row; re-post adds none', async () => {
  const { steam, itad, a, b } = await twoOwners('Split');
  const before = {
    a: await idRowsOf(sql, a),
    b: await idRowsOf(sql, b),
    seqs: [await seqOf(sql, a), await seqOf(sql, b)],
  };
  const r = await post('Split Item', { steam, itad });
  expect(r).toEqual({ result: 'conflict', rlGameId: a });
  const expected = {
    kind: 'itad_uuid',
    value: itad,
    existing: a,
    proposed: b,
    instance: INSTANCE,
    shape: 'object',
    payload: {
      clientRef: 'ref-Split Item',
      kind: 'itad_uuid',
      value: itad,
      provenance: 'itad',
    },
    resolved: null,
  };
  expect(await conflictsOn(itad)).toEqual([expected]);
  expect({
    a: await idRowsOf(sql, a),
    b: await idRowsOf(sql, b),
    seqs: [await seqOf(sql, a), await seqOf(sql, b)],
  }).toEqual(before);
  expect(await post('Split Item', { steam, itad })).toEqual(r);
  expect(await conflictsOn(itad)).toEqual([expected]);
});

it('L7: a resolved conflict does not block a new open one', async () => {
  const { steam, itad } = await twoOwners('Resolved');
  await post('Resolved Item', { steam, itad });
  await sql`UPDATE hub_crosswalk_conflicts SET resolved_at = now()
    WHERE value = ${itad}`;
  expect((await post('Resolved Item', { steam, itad })).result).toBe(
    'conflict',
  );
  const rows = await conflictsOn(itad);
  expect(rows.map((x) => x.resolved === null)).toEqual([false, true]);
});

it('AC5: same name, different IGDB id → a separate game, not a name match', async () => {
  const x = await post('Resident Evil', { igdb: uniq() });
  const y = await post('Resident Evil', { igdb: uniq() });
  expect(x.result).toBe('created');
  expect(y.result).toBe('created');
  expect(y.rlGameId).not.toBe(x.rlGameId);
  expect(await gamesNamed(sql, normalizeForDedup('Resident Evil'))).toBe(2);
});

it('step (c) Q3: several name candidates → the oldest by created_at wins', async () => {
  const name = 'Candidate Quest';
  const first = await post(name, { igdb: uniq() });
  const second = await post(name, { igdb: uniq() });
  // Make the later-minted game the oldest, so rl_game_id order cannot pass.
  await sql`UPDATE hub_games SET created_at = now() - interval '1 day'
    WHERE rl_game_id = ${second.rlGameId}`;
  const steam = uniq();
  const r = await post(name, { steam });
  expect(r).toEqual({ result: 'attached', rlGameId: second.rlGameId });
  const owner = await sql`SELECT rl_game_id FROM hub_game_ids
    WHERE kind = 'steam_app_id' AND value = ${String(steam)}`;
  expect(owner).toEqual([{ rl_game_id: second.rlGameId }]);
  expect((await idRowsOf(sql, first.rlGameId)).map((x) => x.kind)).toEqual([
    'igdb_id',
  ]);
  expect(await gamesNamed(sql, normalizeForDedup(name))).toBe(2);
});

it('step (c): a name candidate attaches every id of the item', async () => {
  const g = await post('Name Only Match', { steam: uniq() });
  const igdb = uniq();
  const itad = randomUUID();
  const r = await post('Name Only Match', { igdb, itad });
  expect(r).toEqual({ result: 'attached', rlGameId: g.rlGameId });
  expect((await idRowsOf(sql, g.rlGameId)).map((x) => x.kind)).toEqual([
    'igdb_id',
    'itad_uuid',
    'steam_app_id',
  ]);
});

it('AC6: partial conflict → new IGDB id attaches to A, ITAD conflicts with B', async () => {
  const { steam, itad, a, b } = await twoOwners('Partial');
  const bRows = await idRowsOf(sql, b);
  const bSeq = await seqOf(sql, b);
  const aSeq = await seqOf(sql, a);
  const igdb = uniq();
  const r = await post('Partial Item', { steam, itad, igdb });
  expect(r).toEqual({ result: 'conflict', rlGameId: a });
  expect((await idRowsOf(sql, a)).map((x) => [x.kind, x.value])).toEqual([
    ['igdb_id', String(igdb)],
    ['steam_app_id', String(steam)],
  ]);
  expect(BigInt(await seqOf(sql, a))).toBeGreaterThan(BigInt(aSeq));
  expect(await idRowsOf(sql, b)).toEqual(bRows);
  expect(await seqOf(sql, b)).toBe(bSeq);
  const rows = await conflictsOn(itad);
  expect(rows.map((x) => [x.kind, x.existing, x.proposed])).toEqual([
    ['itad_uuid', a, b],
  ]);
});

/** Provenance stored on one id row. */
const provenanceOf = async (kind: string, value: string): Promise<unknown> =>
  must(
    (
      await sql`SELECT provenance FROM hub_game_ids
        WHERE kind = ${kind} AND value = ${value}`
    )[0],
    `${kind}:${value}`,
  ).provenance;

it('AC9: steam provenance replaces igdb and bumps; igdb never replaces steam', async () => {
  const steam = uniq();
  const g = await post('Provenance Rise', { steam }, { steam: 'igdb' });
  const seq0 = await seqOf(sql, g.rlGameId);
  const up = await post('Provenance Rise', { steam }, { steam: 'steam' });
  expect(up).toEqual({ result: 'attached', rlGameId: g.rlGameId });
  expect(await provenanceOf('steam_app_id', String(steam))).toBe('steam');
  const seq1 = await seqOf(sql, g.rlGameId);
  expect(BigInt(seq1)).toBeGreaterThan(BigInt(seq0));
  const down = await post('Provenance Rise', { steam }, { steam: 'igdb' });
  expect(down).toEqual({ result: 'matched', rlGameId: g.rlGameId });
  expect(await provenanceOf('steam_app_id', String(steam))).toBe('steam');
  expect(await seqOf(sql, g.rlGameId)).toBe(seq1);
});

it('Q2: equal-rank provenance keeps the first value', async () => {
  const igdb = uniq();
  const g = await post('Equal Rank', { igdb }, { igdb: 'unknown' });
  const seq0 = await seqOf(sql, g.rlGameId);
  const r = await post('Equal Rank', { igdb }, { igdb: 'igdb' });
  expect(r).toEqual({ result: 'matched', rlGameId: g.rlGameId });
  expect(await provenanceOf('igdb_id', String(igdb))).toBe('unknown');
  expect(await seqOf(sql, g.rlGameId)).toBe(seq0);
});
