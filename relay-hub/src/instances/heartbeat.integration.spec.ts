import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import postgres, { type Sql } from 'postgres';
import {
  HubHeartbeatResponseSchema,
  HubRegisterResponseSchema,
} from '@raid-ledger/contract';
import { readFileSync } from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { main } from '../cli/hub-admin';
import { HUB_CONFIG, loadHubConfig } from '../config/hub-config';
import { HUB_SQL } from '../drizzle/drizzle.module';
import {
  DEFAULT_MIGRATIONS_FOLDER,
  runMigrations,
} from '../scripts/run-migrations';
import { createTestDatabase, type TestDatabase } from '../test/test-database';
import { hashToken } from './tokens';

const FIXTURES = path.resolve(
  __dirname,
  '../../../packages/contract/src/relay/__fixtures__/v1',
);
const fixture = (name: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(FIXTURES, name), 'utf8'),
  );
  if (typeof parsed !== 'object' || parsed === null) throw new Error(name);
  return { ...parsed };
};
const registerBody = fixture('register.request.client.json');
/** Today's client heartbeat, usage stats included (AC 2). */
const hbBody = {
  ...fixture('heartbeat.request.client.json'),
  version: '9.9.9',
};
const STAT_KEYS = ['playerCount', 'eventCount', 'activeGames', 'uptimeSeconds'];
const INVALID = { error: 'unknown', message: 'invalid_token' };
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

const http = () => request(app.getHttpServer());
const registerId = async (id: string): Promise<string> => {
  const res = await http()
    .post('/api/v1/instances/register')
    .send({ ...registerBody, instanceId: id })
    .expect(200);
  return HubRegisterResponseSchema.parse(res.body).token;
};
const heartbeat = (id: string, auth?: string) => {
  const req = http().post(`/api/v1/instances/${id}/heartbeat`);
  return (auth === undefined ? req : req.set('Authorization', auth)).send(
    hbBody,
  );
};
const disconnect = (id: string, token: string) =>
  http()
    .delete(`/api/v1/instances/${id}`)
    .set('Authorization', `Bearer ${token}`);
const rowOf = async (id: string) =>
  (
    await sql<Record<string, unknown>[]>`SELECT *, row_to_json(i)::text AS j
      FROM hub_instances i WHERE instance_id = ${id}`
  )[0];
const cli = async (...argv: string[]) => {
  const lines: string[] = [];
  const io = {
    env: { DATABASE_URL: db.url },
    out: (l: string) => lines.push(l),
    err: (l: string) => lines.push(l),
  };
  return { code: await main(argv, io), lines };
};

// Every test owns its instance id, so the file passes in any order.
it('AC2: a pending instance heartbeats: 200, epoch, version stamped, stats dropped', async () => {
  const id = '0a1b2c3d-1111-4a5b-8c6d-7e8f9a0b1c2d';
  const token = await registerId(id);
  const res = await heartbeat(id, `Bearer ${token}`).expect(200);
  const body = HubHeartbeatResponseSchema.parse(res.body);
  const [meta] =
    await sql`SELECT value FROM hub_meta WHERE key = 'catalog_epoch'`;
  expect(body.schemaVersion).toBe(1);
  expect(body.epoch).toBe(meta?.value);
  expect(Math.abs(Date.parse(body.serverTime) - Date.now())).toBeLessThan(
    60_000,
  );
  const row = await rowOf(id);
  expect(row).toMatchObject({ status: 'pending', version: '9.9.9' });
  expect(row?.last_heartbeat_at).toBeInstanceOf(Date);
  for (const key of STAT_KEYS) expect(String(row?.j)).not.toContain(key);
});

it("AC2: wrong, missing or malformed bearer, or another instance's token → 401", async () => {
  const id = '0a1b2c3d-2222-4a5b-8c6d-7e8f9a0b1c2d';
  const other = '0a1b2c3d-3333-4a5b-8c6d-7e8f9a0b1c2d';
  const token = await registerId(id);
  const otherToken = await registerId(other);
  const wrong = `rlh_${'A'.repeat(43)}`;
  for (const auth of [
    `Bearer ${wrong}`,
    undefined,
    `Token ${token}`,
    `Bearer ${otherToken}`,
  ]) {
    const res = await heartbeat(id, auth).expect(401);
    expect(res.body).toEqual(INVALID);
  }
  const notUuid = await heartbeat('not-a-uuid', `Bearer ${token}`).expect(401);
  expect(notUuid.body).toEqual(INVALID);
  expect((await rowOf(id))?.last_heartbeat_at).toBeNull();
});

it('AC1: after a re-register the old token gets 401 and the new one 200', async () => {
  const id = '0a1b2c3d-4444-4a5b-8c6d-7e8f9a0b1c2d';
  const oldToken = await registerId(id);
  const newToken = await registerId(id);
  expect((await heartbeat(id, `Bearer ${oldToken}`).expect(401)).body).toEqual(
    INVALID,
  );
  await heartbeat(id, `Bearer ${newToken}`).expect(200);
});

it('AC3: DELETE → 204 clears the token; it then gets 401 on heartbeat and DELETE', async () => {
  const id = '0a1b2c3d-5555-4a5b-8c6d-7e8f9a0b1c2d';
  const token = await registerId(id);
  await disconnect(id, token).expect(204);
  expect(await rowOf(id)).toMatchObject({
    status: 'disconnected',
    token_hash: null,
  });
  expect((await heartbeat(id, `Bearer ${token}`).expect(401)).body).toEqual(
    INVALID,
  );
  expect((await disconnect(id, token).expect(401)).body).toEqual(INVALID);
});

it('AC4: hub-admin revoke → 401 revoked on heartbeat, 403 on re-register, listed as revoked', async () => {
  const id = '0a1b2c3d-6666-4a5b-8c6d-7e8f9a0b1c2d';
  const token = await registerId(id);
  const reason = 'AC4 reason: token seen in a public paste';
  expect(await cli('revoke', id, '--reason', reason)).toEqual({
    code: 0,
    lines: [`Instance ${id} revoked.`],
  });
  const row = await rowOf(id);
  expect(row).toMatchObject({ status: 'revoked', revoke_reason: reason });
  expect(row?.token_hash).toBe(hashToken(token));
  expect(row?.revoked_at).toBeInstanceOf(Date);
  expect((await heartbeat(id, `Bearer ${token}`).expect(401)).body).toEqual({
    error: 'revoked',
  });
  expect((await disconnect(id, token).expect(401)).body).toEqual({
    error: 'revoked',
  });
  const stranger = `Bearer rlh_${'B'.repeat(43)}`;
  expect((await heartbeat(id, stranger).expect(401)).body).toEqual(INVALID);
  const again = await http()
    .post('/api/v1/instances/register')
    .send({ ...registerBody, instanceId: id })
    .expect(403);
  expect(again.body).toEqual({ error: 'revoked' });
  const listed = await cli('instances');
  expect(listed.lines.find((l) => l.includes(id))).toContain('revoked');
});

it('AC4: revoke without --reason exits 2; an unknown id exits 1', async () => {
  const id = '0a1b2c3d-7777-4a5b-8c6d-7e8f9a0b1c2d';
  await registerId(id);
  expect((await cli('revoke', id)).code).toBe(2);
  expect((await rowOf(id))?.status).toBe('pending');
  const unknown = '0a1b2c3d-8888-4a5b-8c6d-7e8f9a0b1c2d';
  expect((await cli('revoke', unknown, '--reason', 'x')).code).toBe(1);
});

it('AC6: no token, hash or revoke reason reaches the logs or CLI output', async () => {
  const id = '0a1b2c3d-9999-4a5b-8c6d-7e8f9a0b1c2d';
  const token = await registerId(id);
  const reason = 'AC6-secret-reason-text';
  logs.length = 0;
  await heartbeat(id, `Bearer ${token}`).expect(200);
  await heartbeat(id, `Bearer rlh_${'C'.repeat(43)}`).expect(401);
  const revoked = await cli('revoke', id, '--reason', reason);
  await heartbeat(id, `Bearer ${token}`).expect(401);
  await disconnect(id, token).expect(401);
  expect(revoked.lines).toEqual([`Instance ${id} revoked.`]);
  const all = [...logs, ...revoked.lines].join('\n');
  for (const secret of [token.slice(4), hashToken(token), reason]) {
    expect(all).not.toContain(secret);
  }
});
