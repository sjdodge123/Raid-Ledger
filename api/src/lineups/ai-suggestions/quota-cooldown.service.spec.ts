/**
 * Unit tests for the quota-cooldown latch (ROK-1376).
 *
 * The latch is written through a RAW ioredis client, which BullMQ's key
 * prefix does NOT apply to — so the service must fold the queue's prefix
 * into the key itself. Otherwise integration tests (per-spec
 * BULLMQ_KEY_PREFIX) and the local dev env arm/clear ONE global key on
 * the shared raid-ledger-redis container.
 *
 * ROK-1436: that client is now the app's global REDIS_CLIENT rather than
 * the queue's own connection (bullmq 6 dropped `Queue.client`); the queue
 * is injected only to read `opts.prefix`.
 */
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import {
  AiQuotaCooldownService,
  QUOTA_COOLDOWN_TTL_S,
  quotaCooldownKey,
} from './quota-cooldown.service';

function makeDeps(prefix?: string) {
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(0),
  };
  const queue = {
    opts: prefix === undefined ? {} : { prefix },
  } as unknown as Queue;
  return { queue, redis: redis as unknown as Redis, spies: redis };
}

function makeService(prefix?: string) {
  const { queue, redis, spies } = makeDeps(prefix);
  return { service: new AiQuotaCooldownService(queue, redis), client: spies };
}

describe('quotaCooldownKey', () => {
  it('namespaces the latch under the queue prefix', () => {
    expect(quotaCooldownKey('test-1-2-')).toBe(
      'test-1-2-:ai-suggestions:quota-cooldown',
    );
  });

  it('falls back to the BullMQ default prefix when unset', () => {
    expect(quotaCooldownKey(undefined)).toBe(
      'bull:ai-suggestions:quota-cooldown',
    );
  });
});

describe('AiQuotaCooldownService', () => {
  it('activate() arms the latch under the prefixed key with the default TTL', async () => {
    const { service, client } = makeService('test-9-9-');
    await service.activate();
    expect(client.set).toHaveBeenCalledWith(
      'test-9-9-:ai-suggestions:quota-cooldown',
      expect.any(String),
      'EX',
      QUOTA_COOLDOWN_TTL_S,
    );
  });

  it('isActive() probes the same prefixed key', async () => {
    const { service, client } = makeService('test-9-9-');
    client.exists.mockResolvedValue(1);
    await expect(service.isActive()).resolves.toBe(true);
    expect(client.exists).toHaveBeenCalledWith(
      'test-9-9-:ai-suggestions:quota-cooldown',
    );
  });

  it('activate() never throws and isActive() fails open on Redis errors', async () => {
    const { service, client } = makeService('bull');
    client.set.mockRejectedValue(new Error('redis down'));
    client.exists.mockRejectedValue(new Error('redis down'));
    await expect(service.activate()).resolves.toBeUndefined();
    await expect(service.isActive()).resolves.toBe(false);
  });
});
