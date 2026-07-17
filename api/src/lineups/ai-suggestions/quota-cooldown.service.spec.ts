/**
 * Unit tests for the quota-cooldown latch (ROK-1376).
 *
 * The latch is written through the queue's RAW ioredis client, which
 * BullMQ's key prefix does NOT apply to — so the service must fold the
 * queue's prefix into the key itself. Otherwise integration tests
 * (per-spec BULLMQ_KEY_PREFIX) and the local dev env arm/clear ONE
 * global key on the shared raid-ledger-redis container.
 */
import type { Queue } from 'bullmq';
import {
  AiQuotaCooldownService,
  QUOTA_COOLDOWN_TTL_S,
  quotaCooldownKey,
} from './quota-cooldown.service';

function makeQueue(prefix?: string) {
  const client = {
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(0),
  };
  const queue = {
    opts: prefix === undefined ? {} : { prefix },
    client: Promise.resolve(client),
  } as unknown as Queue;
  return { queue, client };
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
    const { queue, client } = makeQueue('test-9-9-');
    await new AiQuotaCooldownService(queue).activate();
    expect(client.set).toHaveBeenCalledWith(
      'test-9-9-:ai-suggestions:quota-cooldown',
      expect.any(String),
      'EX',
      QUOTA_COOLDOWN_TTL_S,
    );
  });

  it('isActive() probes the same prefixed key', async () => {
    const { queue, client } = makeQueue('test-9-9-');
    client.exists.mockResolvedValue(1);
    await expect(new AiQuotaCooldownService(queue).isActive()).resolves.toBe(
      true,
    );
    expect(client.exists).toHaveBeenCalledWith(
      'test-9-9-:ai-suggestions:quota-cooldown',
    );
  });

  it('activate() never throws and isActive() fails open on Redis errors', async () => {
    const { queue, client } = makeQueue('bull');
    client.set.mockRejectedValue(new Error('redis down'));
    client.exists.mockRejectedValue(new Error('redis down'));
    const service = new AiQuotaCooldownService(queue);
    await expect(service.activate()).resolves.toBeUndefined();
    await expect(service.isActive()).resolves.toBe(false);
  });
});
