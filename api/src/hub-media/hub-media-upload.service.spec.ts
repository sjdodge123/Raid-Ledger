/**
 * ROK-1965 — the upload service's result → §6 mapping, and the shared
 * pool's queue-full → 503 `busy` (D9). The route itself is covered by
 * `hub-media.upload.integration.spec.ts` on the fleet.
 */
import { HttpException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type * as schema from '../drizzle/schema';
import { HubMediaIngestPool } from './hub-media-ingest.pool';
import type { HubMediaReadService } from './hub-media-read.service';
import { HubMediaUploadService, mediaIdOf } from './hub-media-upload.service';
import type { HubMediaService } from './hub-media.service';
import { solidPng } from './hub-media.testing';

function codeOf(fn: () => unknown): { status: number; code: unknown } {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof HttpException)) throw err;
    const body = err.getResponse();
    const code = typeof body === 'object' && 'code' in body ? body.code : null;
    return { status: err.getStatus(), code };
  }
  throw new Error('expected a throw');
}

describe('mediaIdOf (§6)', () => {
  it('stored and live duplicate answer their id', () => {
    expect([
      mediaIdOf({ status: 'stored', mediaId: 7 }),
      mediaIdOf({ status: 'duplicate', mediaId: 8 }),
    ]).toEqual([7, 8]);
  });

  it('maps each rejection to its status + code', () => {
    const r = (reason: 'removed' | 'cap' | 'not_image' | 'busy') => () =>
      mediaIdOf({ status: 'rejected', reason });
    expect({
      removed: codeOf(r('removed')),
      cap: codeOf(r('cap')),
      notImage: codeOf(r('not_image')),
      busy: codeOf(r('busy')),
      tombstone: codeOf(() =>
        mediaIdOf({ status: 'duplicate', mediaId: null }),
      ),
    }).toEqual({
      removed: { status: 409, code: 'removed' },
      cap: { status: 413, code: 'cap' },
      notImage: { status: 415, code: 'not_image' },
      busy: { status: 503, code: 'busy' },
      tombstone: { status: 409, code: 'removed' },
    });
  });
});

describe('HubMediaUploadService.upload', () => {
  const actor = { id: 3, role: 'member' as const };
  const viewer = {
    actor,
    scope: { guildId: 1, includeHidden: false },
    rights: { canEdit: false, isLeader: false },
  };

  function build(pool: HubMediaIngestPool) {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      }),
    };
    const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn() };
    const store = {
      ingestUpload: jest
        .fn()
        .mockResolvedValue({ status: 'stored', mediaId: 1 }),
    };
    const read = { viewer: jest.fn().mockResolvedValue(viewer) };
    const svc = new HubMediaUploadService(
      db as unknown as PostgresJsDatabase<typeof schema>,
      redis as unknown as Redis,
      store as unknown as HubMediaService,
      pool,
      read as unknown as HubMediaReadService,
    );
    return { svc, store };
  }

  async function statusOf(p: Promise<unknown>) {
    const err: unknown = await p.then(
      () => null,
      (e: unknown) => e,
    );
    if (!(err instanceof HttpException))
      throw new Error(`not an HttpException: ${String(err)}`);
    const body = err.getResponse();
    return {
      status: err.getStatus(),
      code: typeof body === 'object' && 'code' in body ? body.code : null,
    };
  }

  it('refuses a GIF by magic bytes with 415 not_image, before the pool', async () => {
    const { svc, store } = build(
      new HubMediaIngestPool({ limit: 1, queueMax: 1 }),
    );
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'binary');
    expect(await statusOf(svc.upload(actor, 1, gif))).toEqual({
      status: 415,
      code: 'not_image',
    });
    expect(store.ingestUpload).not.toHaveBeenCalled();
  });

  it('maps a full shared queue to 503 busy (D9)', async () => {
    const pool = new HubMediaIngestPool({ limit: 1, queueMax: 0 });
    let release = (): void => undefined;
    const held = pool.run(
      'hold',
      () => new Promise<void>((r) => (release = r)),
    );
    const { svc } = build(pool);
    const png = await solidPng(8, 8);
    expect(await statusOf(svc.upload(actor, 1, png))).toEqual({
      status: 503,
      code: 'busy',
    });
    release();
    await held;
  });
});
