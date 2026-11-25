import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import request from 'supertest';
import postgres, { type Sql } from 'postgres';
import { HubHealthResponseSchema } from '@raid-ledger/contract';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { HUB_CONFIG, loadHubConfig } from '../config/hub-config';
import { HUB_SQL } from '../drizzle/drizzle.module';
import {
  runMigrations,
  DEFAULT_MIGRATIONS_FOLDER,
} from '../scripts/run-migrations';
import { createTestDatabase, type TestDatabase } from '../test/test-database';

const DEAD_URL = 'postgres://x:y@127.0.0.1:1/none';

/** Boots the hub with HUB_SQL on `url`, counting the queries it issues. */
async function bootHub(url: string) {
  const calls: unknown[] = [];
  const real = postgres(url, {
    max: 2,
    connect_timeout: 2,
    onnotice: () => undefined,
  });
  const sql: Sql = new Proxy(real, {
    apply(target, thisArg, args: unknown[]) {
      calls.push(args);
      const result: unknown = Reflect.apply(target, thisArg, args);
      return result;
    },
  });
  // A fixed config, not the machine's PORT/HOST/NODE_ENV: a runner's stray
  // value must not fail a health-route test with a config error.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HUB_CONFIG)
    .useValue(loadHubConfig({ NODE_ENV: 'test' }))
    .overrideProvider(HUB_SQL)
    .useValue(sql)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return { app, calls };
}

describe('relay-hub health routes (integration, DB up)', () => {
  let db: TestDatabase;
  let hub: Awaited<ReturnType<typeof bootHub>>;

  beforeAll(async () => {
    db = await createTestDatabase();
    await runMigrations(db.url, DEFAULT_MIGRATIONS_FOLDER);
    hub = await bootHub(db.url);
  });
  afterAll(async () => {
    await hub.app.close();
    await db.drop();
  });

  it('GET /api/v1/health carries the hub_meta epoch and parses', async () => {
    const reader = postgres(db.url, { max: 1 });
    const [row] = await reader<{ value: string }[]>`
      SELECT value FROM hub_meta WHERE key = 'catalog_epoch'`;
    await reader.end({ timeout: 5 });
    expect(row?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const res = await request(hub.app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      schemaVersions: [1],
      epoch: row?.value,
    });
    expect(HubHealthResponseSchema.safeParse(res.body).success).toBe(true);
  });

  it('GET /api/v1/health/ready returns 200 {status: ok}', async () => {
    const res = await request(hub.app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/live issues no query', async () => {
    const before = hub.calls.length;
    const res = await request(hub.app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(hub.calls).toHaveLength(before);
  });

  it.each(['/api/v1/nope', '/v1/health', '/api/health'])(
    'GET %s returns 404',
    async (path) => {
      await request(hub.app.getHttpServer()).get(path).expect(404);
    },
  );
});

describe('relay-hub health routes (integration, DB down)', () => {
  let hub: Awaited<ReturnType<typeof bootHub>>;

  beforeAll(async () => {
    hub = await bootHub(DEAD_URL);
  });
  afterAll(async () => {
    await hub.app.close();
  });

  it('GET /api/v1/health/ready returns 503 {status: unavailable}', async () => {
    const res = await request(hub.app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  it('GET /api/v1/health stays 200 and omits epoch', async () => {
    const res = await request(hub.app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok', schemaVersions: [1] });
  });

  it('GET /api/v1/health/live returns 200 without a query', async () => {
    await request(hub.app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(hub.calls).toHaveLength(0);
  });
});
