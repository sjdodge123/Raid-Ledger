import type { INestApplication } from '@nestjs/common';
import { CrosswalkKindSchema } from '@raid-ledger/contract';
import { randomUUID } from 'crypto';
import postgres, { type Sql } from 'postgres';
import type { App } from 'supertest/types';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import { must, testItem } from '../test/crosswalk-test-kit';
import {
  approvedInstance,
  bootHubApp,
  cli,
  contribute,
} from '../test/hub-app-kit';
import { createTestDatabase, type TestDatabase } from '../test/test-database';
import {
  collectStats,
  STATS_PROVENANCES,
  STATS_SOURCES,
} from './crosswalk-stats';

const ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Top-level hooks + tests: one file-wide DB (ROK-1670 L10). Tests run in order.
let db: TestDatabase;
let app: INestApplication<App>;
let sql: Sql;

beforeAll(async () => {
  db = await createTestDatabase();
  await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
  sql = postgres(db.url, { max: 2, onnotice: () => undefined });
  app = await bootHubApp(db.url);
});
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  await db.drop();
});

it('AC4: an empty hub still emits every key, in the L4 order, all zero', async () => {
  const stats = await collectStats(sql);
  expect(Object.keys(stats)).toEqual(['games', 'ids', 'conflicts']);
  expect(Object.keys(stats.ids)).toEqual([
    'byKind',
    'bySource',
    'byProvenance',
  ]);
  expect(Object.keys(stats.ids.byKind)).toEqual(CrosswalkKindSchema.options);
  expect(Object.keys(stats.ids.bySource)).toEqual([...STATS_SOURCES]);
  expect(Object.keys(stats.ids.byProvenance)).toEqual([...STATS_PROVENANCES]);
  expect(stats.games).toBe(0);
  expect(stats.conflicts).toEqual({ open: 0, total: 0 });
});

it('AC4: counts per kind/source/provenance and conflicts; --json is stable and timestamp-free', async () => {
  const token = await approvedInstance(app, db.url, randomUUID());
  const itad = randomUUID();
  const [a] = await contribute(app, token, [
    testItem('Stats Alpha', { steam: 8_100_001, igdb: 8_100_002 }),
  ]);
  await contribute(app, token, [testItem('Stats Beta', { itad })]);
  const [split] = await contribute(app, token, [
    testItem('Stats Split', { steam: 8_100_001, itad }),
  ]);
  expect(must(split, 'split').result).toBe('conflict');
  expect(must(a, 'a').result).toBe('created');

  const stats = await collectStats(sql);
  expect(stats.games).toBe(2);
  expect(stats.ids.byKind).toMatchObject({
    steam_app_id: 1,
    igdb_id: 1,
    itad_uuid: 1,
  });
  expect(stats.ids.byProvenance).toMatchObject({
    steam: 1,
    igdb: 1,
    itad: 1,
    none: 0,
  });
  const total = Object.values(stats.ids.byKind).reduce((s, n) => s + n, 0);
  expect(stats.ids.bySource['instance']).toBe(total);
  expect(stats.conflicts).toEqual({ open: 1, total: 1 });

  const first = await cli(db.url, 'stats', '--json');
  const second = await cli(db.url, 'stats', '--json');
  expect(first.code).toBe(0);
  expect(first.out).toEqual(second.out);
  expect(first.out).toEqual([JSON.stringify(await collectStats(sql))]);
  expect(first.out.join('\n')).not.toMatch(ISO_DATE);

  const text = await cli(db.url, 'stats');
  expect(text.code).toBe(0);
  expect(text.out).toEqual(
    expect.arrayContaining(['games: 2', 'conflicts: open 1 / total 1']),
  );
  expect(text.out.some((l) => /^\s+steam_app_id\s+1$/.test(l))).toBe(true);
});
