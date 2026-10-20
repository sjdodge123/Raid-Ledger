/** ROK-1431 — the unbind hook (D9): only auto-managed game bindings are suppressed. */
import {
  suppressUnboundAutoBindings,
  withReconcileLock,
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

/** A db whose transaction runs the callback on a tx returning `locked`. */
function lockDb(locked: boolean): {
  db: LifecycleDb;
  txExecute: jest.Mock;
  outerExecute: jest.Mock;
} {
  const txExecute = jest.fn().mockResolvedValue([{ locked }]);
  const outerExecute = jest.fn();
  const db = {
    execute: outerExecute,
    transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
      cb({ execute: txExecute }),
    ),
  };
  return { db: db as unknown as LifecycleDb, txExecute, outerExecute };
}

describe('withReconcileLock (single-flight, spec §2.3)', () => {
  it('a held lock → {acquired:false} at once; fn never runs', async () => {
    const { db } = lockDb(false);
    const fn = jest.fn();
    await expect(withReconcileLock(db, fn)).resolves.toEqual({
      acquired: false,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('takes the xact lock on the transaction connection, never the pool', async () => {
    const { db, txExecute, outerExecute } = lockDb(true);
    await expect(
      withReconcileLock(db, () => Promise.resolve(7)),
    ).resolves.toEqual({ acquired: true, value: 7 });
    expect(txExecute).toHaveBeenCalledTimes(1);
    expect(outerExecute).not.toHaveBeenCalled();
  });

  it('fn rejecting rejects the transaction (rollback releases the xact lock)', async () => {
    const { db } = lockDb(true);
    const boom = new Error('Failed query: insert into "app_settings"');
    await expect(
      withReconcileLock(db, () => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });
});
