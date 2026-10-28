/**
 * ROK-1965 review M1–M3 — `HubMediaUploadGuard` refuses everything it can
 * BEFORE multer buffers the body (guards run before interceptors): a
 * malformed id (400) never reaches the DB, and the per-user window (429) is
 * checked here. The window's counter always carries a TTL.
 */
import { BadRequestException, HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { createRedisMock } from '../common/testing/redis-mock';
import type * as schema from '../drizzle/schema';
import type { GuildAccessService } from '../guilds/guild-access.service';
import { HubMediaUploadGuard } from './hub-media-upload.guard';
import {
  UPLOAD_WINDOW_SECONDS,
  checkUploadRate,
  uploadRateKey,
} from './hub-media-upload.limits';
import { assertCanViewHubMedia } from './hub-media.access';

jest.mock('./hub-media.access', () => ({
  assertCanViewHubMedia: jest.fn(),
}));
const viewGate = jest.mocked(assertCanViewHubMedia);

const ctxFor = (guildId: string, userId = 3): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        params: { guildId },
        user: { id: userId, role: 'member' },
      }),
    }),
  }) as unknown as ExecutionContext;

function build() {
  const redis = createRedisMock().client;
  const guard = new HubMediaUploadGuard(
    {} as PostgresJsDatabase<typeof schema>,
    {} as GuildAccessService,
    redis as unknown as Redis,
  );
  return { guard, redis };
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeEach(() => {
  viewGate.mockReset();
  viewGate.mockResolvedValue({ canEdit: false, isLeader: false });
});

afterEach(() => {
  delete process.env.HUB_MEDIA_UPLOAD_PER_HOUR;
});

describe('HubMediaUploadGuard', () => {
  it('answers a malformed hub id with 400 Invalid id before the view gate', async () => {
    const { guard } = build();
    const err = await errorOf(guard.canActivate(ctxFor('abc')));
    expect({
      isBadRequest: err instanceof BadRequestException,
      message: err instanceof Error ? err.message : String(err),
      viewGateCalls: viewGate.mock.calls.length,
    }).toEqual({ isBadRequest: true, message: 'Invalid id', viewGateCalls: 0 });
  });

  it('answers 429 rate_limited from the guard once the window is spent', async () => {
    process.env.HUB_MEDIA_UPLOAD_PER_HOUR = '1';
    const { guard } = build();
    const first = await guard.canActivate(ctxFor('7'));
    const err = await errorOf(guard.canActivate(ctxFor('7')));
    const body = err instanceof HttpException ? err.getResponse() : null;
    expect({
      first,
      status: err instanceof HttpException ? err.getStatus() : null,
      code:
        typeof body === 'object' && body !== null && 'code' in body
          ? body.code
          : null,
    }).toEqual({ first: true, status: 429, code: 'rate_limited' });
  });
});

describe('checkUploadRate window TTL (M3)', () => {
  it('a new window key gets the hour TTL, and a key left without one is healed', async () => {
    process.env.HUB_MEDIA_UPLOAD_PER_HOUR = '20';
    const { redis } = build();
    await checkUploadRate(redis as unknown as Redis, 3);
    const fresh = await redis.ttl(uploadRateKey(3));
    await redis.set(uploadRateKey(4), '5');
    await checkUploadRate(redis as unknown as Redis, 4);
    expect({
      fresh: fresh > 0 && fresh <= UPLOAD_WINDOW_SECONDS,
      healed: (await redis.ttl(uploadRateKey(4))) > 0,
      count: await redis.get(uploadRateKey(4)),
    }).toEqual({ fresh: true, healed: true, count: '6' });
  });
});
