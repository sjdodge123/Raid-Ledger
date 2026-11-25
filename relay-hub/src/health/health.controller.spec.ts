import { HttpException } from '@nestjs/common';
import {
  HUB_SCHEMA_VERSION,
  HubHealthResponseSchema,
} from '@raid-ledger/contract';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import * as schema from '../drizzle/schema';
import { EpochService } from './epoch.service';
import { HealthController } from './health.controller';

const FIXTURE_PATH = join(
  __dirname,
  '../../../packages/contract/src/relay/__fixtures__/v1/health.response.json',
);
const fixture = HubHealthResponseSchema.parse(
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')),
);

/** A lazy client on a refused port, counting every query issued through it. */
function deadSql() {
  const real = postgres('postgres://x:y@127.0.0.1:1/none', {
    max: 1,
    connect_timeout: 1,
  });
  const calls: unknown[] = [];
  const sql = new Proxy(real, {
    apply(target, thisArg, args: unknown[]) {
      calls.push(args);
      const result: unknown = Reflect.apply(target, thisArg, args);
      return result;
    },
  });
  return { sql, calls };
}

describe('HealthController', () => {
  const { sql, calls } = deadSql();
  const epoch = new EpochService(drizzle(sql, { schema }));
  const controller = new HealthController(sql, epoch);

  afterAll(async () => {
    await sql.end({ timeout: 1 });
  });
  afterEach(() => jest.restoreAllMocks());

  it('equals the golden fixture once the epoch is known', async () => {
    jest.spyOn(epoch, 'current').mockResolvedValue(fixture.epoch);
    const body = await controller.health();
    expect(body).toEqual(fixture);
    expect(HubHealthResponseSchema.parse(body)).toEqual(body);
  });

  it('omits epoch (still a valid body) while the DB was never reached', async () => {
    const body = await controller.health();
    expect(body).toEqual({
      status: 'ok',
      schemaVersions: [HUB_SCHEMA_VERSION],
    });
    expect(HubHealthResponseSchema.safeParse(body).success).toBe(true);
  });

  it('answers the live probe without issuing a query', () => {
    const before = calls.length;
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(calls).toHaveLength(before);
  });

  it('answers ready with 503 {status: unavailable} when the DB is down', async () => {
    const err = await controller.ready().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err instanceof HttpException && err.getStatus()).toBe(503);
    expect(err instanceof HttpException && err.getResponse()).toEqual({
      status: 'unavailable',
    });
  });
});
