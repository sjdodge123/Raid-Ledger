import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CrosswalkContributionResponseSchema,
  HubRegisterResponseSchema,
  type CrosswalkContributionItem,
  type CrosswalkContributionResult,
} from '@raid-ledger/contract';
import { readFileSync } from 'fs';
import * as path from 'path';
import postgres, { type Sql } from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { main } from '../cli/hub-admin';
import { HUB_CONFIG, loadHubConfig } from '../config/hub-config';
import { HUB_SQL } from '../drizzle/drizzle.module';

/** ROK-1674 integration-spec helpers: a booted hub, the CLI, the contract fixtures. */
export const CONTRIBUTIONS = '/api/v1/crosswalk/contributions';
const FIXTURES = path.resolve(
  __dirname,
  '../../../packages/contract/src/relay/__fixtures__/v1',
);

/** A contract fixture as a plain object (fails loudly if it is not one). */
export function fixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(FIXTURES, name), 'utf8'),
  );
  if (typeof parsed !== 'object' || parsed === null) throw new Error(name);
  return { ...parsed };
}

/** A logger that keeps every line (AC 7 captured-logger assertions). */
export function captureLogger(lines: string[]): LoggerService {
  const push = (m: unknown): void => {
    lines.push(String(m));
  };
  return { log: push, error: push, warn: push, debug: push, verbose: push };
}

/** Boots the whole hub (AppModule) on `dbUrl`, as `heartbeat.integration.spec.ts` does. */
export async function bootHubApp(
  dbUrl: string,
  logger?: LoggerService,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HUB_CONFIG)
    .useValue(loadHubConfig({ NODE_ENV: 'test' }))
    .overrideProvider(HUB_SQL)
    .useValue(postgres(dbUrl, { max: 2, onnotice: () => undefined }))
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  if (logger) app.useLogger(logger);
  configureApp(app);
  await app.init();
  return app;
}

/** Runs `hub-admin` against `dbUrl`; stdout and stderr kept apart. */
export async function cli(
  dbUrl: string,
  ...argv: string[]
): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    env: { DATABASE_URL: dbUrl },
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  };
  return { code: await main(argv, io), out, err };
}

/** Registers `instanceId` (pending) and returns its bearer token. */
export async function registerInstance(
  app: INestApplication<App>,
  instanceId: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/instances/register')
    .send({ ...fixture('register.request.client.json'), instanceId })
    .expect(200);
  return HubRegisterResponseSchema.parse(res.body).token;
}

/** Registers and approves `instanceId` through the CLI; returns its token. */
export async function approvedInstance(
  app: INestApplication<App>,
  dbUrl: string,
  instanceId: string,
): Promise<string> {
  const token = await registerInstance(app, instanceId);
  expect((await cli(dbUrl, 'approve', instanceId)).code).toBe(0);
  return token;
}

/** POSTs a contribution body with a bearer token (no status assertion). */
export function postContributions(
  app: INestApplication<App>,
  token: string,
  body: object,
): request.Test {
  return request(app.getHttpServer())
    .post(CONTRIBUTIONS)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** POSTs `items` (expects 200) and returns the parsed results. */
export async function contribute(
  app: INestApplication<App>,
  token: string,
  items: readonly CrosswalkContributionItem[],
): Promise<CrosswalkContributionResult[]> {
  const res = await postContributions(app, token, { schemaVersion: 1, items });
  expect(res.status).toBe(200);
  return CrosswalkContributionResponseSchema.parse(res.body).results;
}

/** Row counts of the three crosswalk tables (AC 1/2 "nothing written"). */
export async function crosswalkCounts(
  sql: Sql,
): Promise<{ games: number; ids: number; conflicts: number }> {
  const [row] = await sql<{ games: number; ids: number; conflicts: number }[]>`
    SELECT (SELECT count(*) FROM hub_games)::int AS games,
           (SELECT count(*) FROM hub_game_ids)::int AS ids,
           (SELECT count(*) FROM hub_crosswalk_conflicts)::int AS conflicts`;
  if (!row) throw new Error('missing counts row');
  return row;
}
