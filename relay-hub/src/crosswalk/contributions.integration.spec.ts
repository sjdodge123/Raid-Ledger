import type { INestApplication } from '@nestjs/common';
import {
  CrosswalkContributionResponseSchema,
  CrosswalkContributionResultSchema,
} from '@raid-ledger/contract';
import postgres, { type Sql } from 'postgres';
import type { App } from 'supertest/types';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import {
  approvedInstance,
  bootHubApp,
  captureLogger,
  cli,
  crosswalkCounts,
  fixture,
  postContributions,
  registerInstance,
} from '../test/hub-app-kit';
import { createTestDatabase, type TestDatabase } from '../test/test-database';

const logs: string[] = [];
const FIXTURE = fixture('contributions.request.json');
const NAMES = ['Dota 2', 'Deep Rock Galactic'];

// Top-level hooks + tests: one file-wide DB (ROK-1670 L10).
let db: TestDatabase;
let app: INestApplication<App>;
let sql: Sql;

beforeAll(async () => {
  db = await createTestDatabase();
  await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
  sql = postgres(db.url, { max: 2, onnotice: () => undefined });
  app = await bootHubApp(db.url, captureLogger(logs));
});
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  await db.drop();
});

it('AC1: a pending instance gets 403 not_contributor and nothing is written; approved → 200', async () => {
  const id = '1a1a1a1a-1111-4111-8111-111111111111';
  const token = await registerInstance(app, id);
  const before = await crosswalkCounts(sql);
  const res = await postContributions(app, token, FIXTURE);
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ error: 'not_contributor' });
  expect(await crosswalkCounts(sql)).toEqual(before);
  expect((await cli(db.url, 'approve', id)).code).toBe(0);
  expect((await postContributions(app, token, FIXTURE)).status).toBe(200);
});

it('AC1: a revoked token gets 401 revoked; an unknown token the generic 401', async () => {
  const id = '1b1b1b1b-1111-4111-8111-111111111111';
  const token = await approvedInstance(app, db.url, id);
  expect((await cli(db.url, 'revoke', id, '--reason', 'test')).code).toBe(0);
  const revoked = await postContributions(app, token, FIXTURE);
  expect(revoked.status).toBe(401);
  expect(revoked.body).toEqual({ error: 'revoked' });
  const unknown = await postContributions(
    app,
    `rlh_${'x'.repeat(43)}`,
    FIXTURE,
  );
  expect(unknown.status).toBe(401);
  expect(unknown.body).toEqual({ error: 'unknown', message: 'invalid_token' });
});

const steamItem = (i: number) => ({
  clientRef: `r${i}`,
  name: `Batch Game ${i}`,
  steamAppId: 7_000_000 + i,
  provenance: { steamAppId: 'steam' },
});
const BAD_BODIES: [string, object][] = [
  [
    'a summary key',
    { schemaVersion: 1, items: [{ ...steamItem(1), summary: 'x' }] },
  ],
  [
    '101 items',
    {
      schemaVersion: 1,
      items: Array.from({ length: 101 }, (_, i) => steamItem(i)),
    },
  ],
  [
    'no strong id',
    {
      schemaVersion: 1,
      items: [{ clientRef: 'n', name: 'No Ids', provenance: {} }],
    },
  ],
];

it.each(BAD_BODIES)(
  'AC2: %s → 400 validation_failed, nothing written',
  async (_label, body) => {
    const token = await approvedInstance(app, db.url, crypto.randomUUID());
    const before = await crosswalkCounts(sql);
    const res = await postContributions(app, token, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'validation_failed' });
    expect(await crosswalkCounts(sql)).toEqual(before);
  },
);

it('AC2: schemaVersion 2 → 426 schema_unsupported, nothing written', async () => {
  const token = await approvedInstance(app, db.url, crypto.randomUUID());
  const before = await crosswalkCounts(sql);
  // Items never stored before, so "nothing written" cannot pass on an upsert.
  const fresh = [steamItem(8_100_001), steamItem(8_100_002)];
  const res = await postContributions(app, token, {
    schemaVersion: 2,
    items: fresh,
  });
  expect(res.status).toBe(426);
  expect(res.body).toMatchObject({ error: 'schema_unsupported' });
  expect(await crosswalkCounts(sql)).toEqual(before);
  const values = fresh.map((i) => String(i.steamAppId));
  const [stored] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM hub_game_ids
    WHERE kind = 'steam_app_id' AND value IN ${sql(values)}`;
  expect(stored?.n).toBe(0);
  const [games] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM hub_games
    WHERE display_name IN ${sql(fresh.map((i) => i.name))}`;
  expect(games?.n).toBe(0);
});

it('AC3 + AC7: the fixture → one contract-valid result per item, in order; one count-only log line', async () => {
  const id = '3c3c3c3c-3333-4333-8333-333333333333';
  const token = await approvedInstance(app, db.url, id);
  logs.length = 0;
  const res = await postContributions(app, token, FIXTURE);
  expect(res.status).toBe(200);
  const body = CrosswalkContributionResponseSchema.parse(res.body);
  expect(body.schemaVersion).toBe(1);
  expect(body.results.map((r) => r.clientRef)).toEqual(['101', '102']);
  for (const r of body.results) {
    expect(CrosswalkContributionResultSchema.safeParse(r).success).toBe(true);
    expect(r.result).not.toBe('unknown');
  }
  const line = logs.filter((l) => l.startsWith('contributions '));
  expect(line).toHaveLength(1);
  expect(line[0]).toMatch(
    new RegExp(
      `^contributions instance=${id} items=2 created=\\d+ matched=\\d+ attached=\\d+ conflict=\\d+$`,
    ),
  );
  for (const name of NAMES) {
    expect(logs.some((l) => l.includes(name))).toBe(false);
  }
});
