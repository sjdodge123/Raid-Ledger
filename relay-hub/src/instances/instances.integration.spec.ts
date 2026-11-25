import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import postgres, { type Sql } from 'postgres';
import { HubRegisterResponseSchema } from '@raid-ledger/contract';
import { readFileSync } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { HUB_CONFIG, loadHubConfig } from '../config/hub-config';
import { HUB_DB, HUB_SQL, type HubDb } from '../drizzle/drizzle.module';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import { createTestDatabase, type TestDatabase } from '../test/test-database';
import { InstancesRepository } from './instances.repository';
import { hashToken } from './tokens';

const FIXTURE = path.resolve(
  __dirname,
  '../../../packages/contract/src/relay/__fixtures__/v1/register.request.client.json',
);
/** Today's client body, usage stats included (AC 1). */
const clientBody = z
  .object({ instanceId: z.string() })
  .loose()
  .parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
const ID = clientBody.instanceId;
const logs: string[] = [];
const capture: LoggerService = {
  log: (m: unknown) => logs.push(String(m)),
  error: (m: unknown) => logs.push(String(m)),
  warn: (m: unknown) => logs.push(String(m)),
  debug: (m: unknown) => logs.push(String(m)),
  verbose: (m: unknown) => logs.push(String(m)),
};

// Top-level hooks + tests: one file-wide DB (ROK-1670 L10).
let db: TestDatabase;
let app: INestApplication<App>;
let sql: Sql;

beforeAll(async () => {
  db = await createTestDatabase();
  await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
  sql = postgres(db.url, { max: 2, onnotice: () => undefined });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HUB_CONFIG)
    .useValue(loadHubConfig({ NODE_ENV: 'test' }))
    .overrideProvider(HUB_SQL)
    .useValue(postgres(db.url, { max: 2, onnotice: () => undefined }))
    .compile();
  app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useLogger(capture);
  configureApp(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  await db.drop();
});

const register = (body: object) =>
  request(app.getHttpServer()).post('/api/v1/instances/register').send(body);
const rowText = async (id: string): Promise<string | undefined> =>
  (
    await sql<{ t: string }[]>`SELECT row_to_json(i)::text AS t
      FROM hub_instances i WHERE instance_id = ${id}`
  )[0]?.t;
const rowOf = async (id: string) =>
  (
    await sql<Record<string, unknown>[]>`SELECT * FROM hub_instances
      WHERE instance_id = ${id}`
  )[0];
/** Registers `id` (200 expected) and returns its token. */
const registerId = async (id: string): Promise<string> => {
  const res = await register({ ...clientBody, instanceId: id }).expect(200);
  return HubRegisterResponseSchema.parse(res.body).token;
};
const revoke = (id: string) =>
  sql`UPDATE hub_instances SET status = 'revoked', revoked_at = now(),
    revoke_reason = 'test' WHERE instance_id = ${id}`;

// Every test owns its instance id, so the file passes in any order.
it('AC1: registers the client body as pending and stores only the hash', async () => {
  const res = await register(clientBody).expect(200);
  const parsed = HubRegisterResponseSchema.parse(res.body);
  expect(parsed.token).toMatch(/^rlh_[A-Za-z0-9_-]{43}$/);
  const [meta] =
    await sql`SELECT value FROM hub_meta WHERE key = 'catalog_epoch'`;
  expect(parsed).toMatchObject({ trustTier: 'reader', schemaVersion: 1 });
  expect(parsed.epoch).toBe(meta?.value);
  const row = await rowOf(ID);
  expect(row).toMatchObject({ status: 'pending', trust_tier: 'reader' });
  expect(row?.token_hash).toBe(hashToken(parsed.token));
  expect(await rowText(ID)).not.toContain(parsed.token.slice(4));
  expect(
    await sql`SELECT count(*)::int AS n FROM hub_instances
      WHERE instance_id = ${ID}`,
  ).toEqual([{ n: 1 }]);
});

it('AC1: no hub_instances column can hold a usage stat, IP or user agent', async () => {
  const cols = await sql`SELECT column_name FROM information_schema.columns
    WHERE table_name = 'hub_instances' ORDER BY ordinal_position`;
  expect(cols.map((c) => String(c.column_name))).toEqual([
    'instance_id',
    'token_hash',
    'status',
    'trust_tier',
    'version',
    'schema_version',
    'registered_at',
    'approved_at',
    'last_heartbeat_at',
    'revoked_at',
    'revoke_reason',
  ]);
});

it('AC2: re-register mints a new token and resets an approved instance', async () => {
  const id = '5e2d9a71-4c8b-4f03-a6e1-8b7c2d4f9a35';
  const first = await registerId(id);
  await sql`UPDATE hub_instances SET status = 'approved',
    trust_tier = 'contributor', approved_at = now() WHERE instance_id = ${id}`;
  const before = await rowOf(id);
  expect(before?.approved_at).toBeInstanceOf(Date);
  const res = await register({ ...clientBody, instanceId: id }).expect(200);
  const parsed = HubRegisterResponseSchema.parse(res.body);
  expect(parsed.token).not.toBe(first);
  expect(parsed.trustTier).toBe('reader');
  const after = await rowOf(id);
  expect(after?.token_hash).not.toBe(before?.token_hash);
  expect(after?.token_hash).toBe(hashToken(parsed.token));
  expect(after).toMatchObject({ status: 'pending', trust_tier: 'reader' });
  expect(after?.approved_at).toBeNull();
  expect(after?.registered_at).toEqual(before?.registered_at);
});

it('AC3: a revoked instance gets 403 revoked and its row is unchanged', async () => {
  const id = '0b8e7a52-41c3-4d6f-9e1a-2c5d8f7b3a90';
  await registerId(id);
  await revoke(id);
  const before = await rowText(id);
  const res = await register({ ...clientBody, instanceId: id }).expect(403);
  expect(res.body).toEqual({ error: 'revoked' });
  expect(await rowText(id)).toBe(before);
});

it('L4: the upsert itself refuses a revoked row (race-safe, no pre-check)', async () => {
  const id = '7a3c5e91-2b4d-4f86-9c0e-1d3f5a7b9c24';
  await registerId(id);
  await revoke(id);
  const before = await rowText(id);
  const repo = new InstancesRepository(app.get<HubDb>(HUB_DB));
  const result = await repo.upsertPending({
    instanceId: id,
    tokenHash: hashToken('rlh_race'),
    version: '9.9.9',
    schemaVersion: 1,
  });
  expect(result).toBeUndefined();
  expect(await rowText(id)).toBe(before);
});

it.each([
  ['a bad uuid', { ...clientBody, instanceId: 'nope' }],
  [
    'a 41-char version',
    {
      ...clientBody,
      instanceId: '2f6b8d04-9e1a-4c37-b5d2-6a8e0c4f1b73',
      version: 'v'.repeat(41),
    },
  ],
])('AC4: %s → 400 validation_failed and no row', async (_label, body) => {
  const before = await sql`SELECT count(*)::int AS n FROM hub_instances`;
  const res = await register(body).expect(400);
  expect(res.body).toMatchObject({ error: 'validation_failed' });
  expect(await sql`SELECT count(*)::int AS n FROM hub_instances`).toEqual(
    before,
  );
});

it('AC4: schemaVersion 2 → 426 schema_unsupported', async () => {
  const id = '6d1f0c3b-8a2e-4f57-b9d4-7e3a1c6b5f28';
  const res = await register({
    ...clientBody,
    instanceId: id,
    schemaVersion: 2,
  });
  expect(res.status).toBe(426);
  expect(res.body).toMatchObject({ error: 'schema_unsupported' });
  expect(await rowOf(id)).toBeUndefined();
});

it('AC4: an enrollmentCode registers normally and is stored nowhere', async () => {
  const id = '9c4a2e7f-1b3d-4a68-8f5e-0d2b7c9a6e14';
  const code = 'ENROLL-CODE-SHOULD-NOT-PERSIST';
  const res = await register({
    ...clientBody,
    instanceId: id,
    enrollmentCode: code,
  });
  expect(res.status).toBe(200);
  expect(await rowText(id)).not.toContain(code);
});

it('AC7: no log line carries a raw token, its hash or the DB password', async () => {
  const id = '4d8f1b6a-3e5c-4a92-8b07-c2e4f6a8d013';
  const tokens = [await registerId(id), await registerId(id)];
  const text = logs.join('\n');
  // The capture works: this test's own registrations were logged.
  expect(text).toContain(id);
  const password = decodeURIComponent(new URL(db.url).password);
  for (const token of tokens) {
    expect(text).not.toContain(token);
    expect(text).not.toContain(hashToken(token));
  }
  if (password) expect(text).not.toContain(password);
});
