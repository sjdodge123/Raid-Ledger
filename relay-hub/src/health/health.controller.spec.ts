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
import { HealthController, READY_TIMEOUT_MS } from './health.controller';

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

/** A client whose queries hang until cancelled (cancel rejects, as postgres.js does). */
function hungSql() {
  const real = postgres('postgres://x:y@127.0.0.1:1/none', { max: 1 });
  const issued: { cancel: jest.Mock }[] = [];
  const sql = new Proxy(real, {
    apply() {
      let fail: (err: Error) => void = () => undefined;
      const query = Object.assign(
        new Promise<never>((_resolve, reject) => (fail = reject)),
        { cancel: jest.fn(() => fail(new Error('57014 canceled'))) },
      );
      issued.push(query);
      return query;
    },
  });
  return { sql, issued, real };
}

describe('HealthController ready single-flight', () => {
  const { sql, issued, real } = hungSql();
  const epoch = new EpochService(drizzle(sql, { schema }));
  const controller = new HealthController(sql, epoch);

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  afterAll(async () => {
    await real.end({ timeout: 1 });
  });

  it('shares one hung query between probes and cancels it on timeout', async () => {
    const probes = [controller.ready(), controller.ready(), controller.ready()];
    const outcomes = Promise.allSettled(probes);
    expect(issued).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    const statuses = (await outcomes).map((o) =>
      o.status === 'rejected' && o.reason instanceof HttpException
        ? o.reason.getStatus()
        : o.status,
    );
    expect(statuses).toEqual([503, 503, 503]);
    expect(issued[0]?.cancel).toHaveBeenCalled();
  });

  it('starts a fresh query once the cancelled one has settled', async () => {
    const before = issued.length;
    const probe = controller.ready().catch((e: unknown) => e);
    expect(issued).toHaveLength(before + 1);
    await jest.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    expect(await probe).toBeInstanceOf(HttpException);
  });
});
