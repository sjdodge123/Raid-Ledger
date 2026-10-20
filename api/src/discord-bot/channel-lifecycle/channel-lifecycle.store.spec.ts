/** ROK-1431 — the unbind hook (D9): only auto-managed game bindings are suppressed. */
import { Logger } from '@nestjs/common';
import {
  RECONCILE_LEASE_KEY,
  RECONCILE_LEASE_MS,
  suppressUnboundAutoBindings,
  withReconcileLock,
  type LeaseRedis,
  type LifecycleDb,
} from './channel-lifecycle.store';

function fakeDb(): { db: LifecycleDb; values: jest.Mock } {
  const values = jest.fn().mockReturnValue({
    onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
  });
  const db = { insert: jest.fn().mockReturnValue({ values }) };
  return { db: db as unknown as LifecycleDb, values };
}

const base = {
  guildId: 'g1',
  gameId: 7,
  autoManaged: true,
  recurrenceGroupId: null,
  bindingPurpose: 'game-announcements',
};

describe('suppressUnboundAutoBindings', () => {
  it('inserts an `unbound` suppression for an auto-managed game binding', async () => {
    const { db, values } = fakeDb();
    await suppressUnboundAutoBindings(db, [base]);
    expect(values).toHaveBeenCalledWith({
      guildId: 'g1',
      gameId: 7,
      reason: 'unbound',
    });
  });
  it.each([
    ['manual', { autoManaged: false }],
    ['series', { recurrenceGroupId: 'rg' }],
    ['no game', { gameId: null }],
    ['other purpose', { bindingPurpose: 'general-lobby' }],
  ])('skips a %s binding', async (_label, patch) => {
    const { db, values } = fakeDb();
    await suppressUnboundAutoBindings(db, [{ ...base, ...patch }]);
    expect(values).not.toHaveBeenCalled();
  });
});

/** A Redis fake whose `SET NX` answers `setReply`. */
function leaseRedis(setReply: 'OK' | null): {
  redis: LeaseRedis;
  set: jest.Mock;
  evalFn: jest.Mock;
} {
  const set = jest.fn().mockResolvedValue(setReply);
  const evalFn = jest.fn().mockResolvedValue(1);
  const redis = { set, eval: evalFn } as unknown as LeaseRedis;
  return { redis, set, evalFn };
}

describe('withReconcileLock (single-flight lease, spec §2.3, Codex r4b P1)', () => {
  it('a held lease → {acquired:false} at once; fn never runs', async () => {
    const { redis, evalFn } = leaseRedis(null);
    const fn = jest.fn();
    await expect(withReconcileLock(redis, fn)).resolves.toEqual({
      acquired: false,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(evalFn).not.toHaveBeenCalled();
  });

  it('takes the lease with SET NX PX (expiring) and releases it by token', async () => {
    const { redis, set, evalFn } = leaseRedis('OK');
    await expect(
      withReconcileLock(redis, () => Promise.resolve(7)),
    ).resolves.toEqual({ acquired: true, value: 7 });
    const token: unknown = set.mock.calls[0]?.[1];
    expect(set).toHaveBeenCalledWith(
      RECONCILE_LEASE_KEY,
      expect.any(String),
      'PX',
      RECONCILE_LEASE_MS,
      'NX',
    );
    expect(evalFn).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('del'"),
      1,
      RECONCILE_LEASE_KEY,
      token,
    );
  });

  it('fn rejecting still releases the lease, then rejects', async () => {
    const { redis, evalFn } = leaseRedis('OK');
    const boom = new Error('Failed query: insert into "app_settings"');
    await expect(
      withReconcileLock(redis, () => Promise.reject(boom)),
    ).rejects.toBe(boom);
    expect(evalFn).toHaveBeenCalledTimes(1);
  });

  it('a failed release does not mask the result (the lease expires)', async () => {
    const { redis, evalFn } = leaseRedis('OK');
    evalFn.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      withReconcileLock(redis, () => Promise.resolve('ok')),
    ).resolves.toEqual({ acquired: true, value: 'ok' });
  });
});

describe('withReconcileLock release hardening (a release never throws)', () => {
  it('a release that throws synchronously is swallowed and logged at warn', async () => {
    const { redis, evalFn } = leaseRedis('OK');
    evalFn.mockImplementation(() => {
      throw new TypeError('redis.eval is not a function');
    });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await expect(
        withReconcileLock(redis, () => Promise.resolve('ok')),
      ).resolves.toEqual({ acquired: true, value: 'ok' });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('redis.eval is not a function'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('a sync release throw does not mask fn rejecting', async () => {
    const { redis, evalFn } = leaseRedis('OK');
    evalFn.mockImplementation(() => {
      throw new TypeError('sync');
    });
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementationOnce(() => undefined);
    const boom = new Error('fn failed');
    await expect(
      withReconcileLock(redis, () => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });
});
