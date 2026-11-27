/**
 * ROK-2364 — the USER_LIFECYCLE registry. Module-scope state persists across
 * cases in this file, so each case registers under its own owner ids and
 * asserts only on its own hooks.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import {
  registerUserLifecycleHooks,
  runCharacterDeleted,
  runPrepareWipe,
  runUserDeactivated,
  runUserReactivated,
  userLifecycleHooks,
} from './user-lifecycle.registry';
import type { UserLifecycleHooks, UserLifecycleTx } from './user-lifecycle.types';

const tx: UserLifecycleTx = createDrizzleMock() as unknown as UserLifecycleTx;

describe('user-lifecycle registry (ROK-2364)', () => {
  it('keeps one hooks object per owner: re-registering replaces, never doubles', async () => {
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);
    registerUserLifecycleHooks('idem', { onUserDeactivated: first });
    registerUserLifecycleHooks('idem', { onUserDeactivated: second });
    await runUserDeactivated(tx, 5, 9);
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[tx, 5, 9]]);
  });

  it('lists hooks in owner-id order, whatever the registration order', () => {
    const zeta: UserLifecycleHooks = {};
    const alpha: UserLifecycleHooks = {};
    registerUserLifecycleHooks('order-zeta', zeta);
    registerUserLifecycleHooks('order-alpha', alpha);
    const mine = userLifecycleHooks().filter((h) => h === zeta || h === alpha);
    expect(mine).toEqual([alpha, zeta]);
  });

  it('wipe is two-phase: every prepare runs before the delete, every finisher after', async () => {
    const calls: string[] = [];
    registerUserLifecycleHooks('wipe-a', {
      prepareWipe: async (_t, userId) => {
        calls.push(`prepare-a:${userId}`);
        return async () => {
          calls.push('finish-a');
        };
      },
    });
    registerUserLifecycleHooks('wipe-b', {
      prepareWipe: async () => {
        calls.push('prepare-b');
        return async () => {
          calls.push('finish-b');
        };
      },
    });
    const finish = await runPrepareWipe(tx, 42);
    calls.push('delete');
    await finish(tx);
    const mine = calls.filter((c) => /-(a|b)(:|$)|delete/.test(c));
    expect(mine).toEqual(['prepare-a:42', 'prepare-b', 'delete', 'finish-a', 'finish-b']);
  });

  it('reactivate returns the sum of every hook\'s audit count', async () => {
    const base = await runUserReactivated(tx, 1, '2026-01-01 00:00:00', null);
    registerUserLifecycleHooks('react-a', { onUserReactivated: jest.fn().mockResolvedValue(2) });
    registerUserLifecycleHooks('react-b', { onUserReactivated: jest.fn().mockResolvedValue(3) });
    const total = await runUserReactivated(tx, 1, '2026-01-01 00:00:00', null);
    expect(total - base).toBe(5);
  });

  it('passes the deleted character row and actor through', async () => {
    const onCharacterDeleted = jest.fn().mockResolvedValue(undefined);
    registerUserLifecycleHooks('char', { onCharacterDeleted });
    const row = { addonGuid: 'Player-1', gameId: 3, region: null };
    await runCharacterDeleted(tx, row, 11);
    expect(onCharacterDeleted.mock.calls).toEqual([[tx, row, 11]]);
  });

  it('a throwing hook propagates (the caller tx aborts) and stops later hooks', async () => {
    const later = jest.fn().mockResolvedValue(undefined);
    // Throws only for user 999, so the other cases' runs stay unaffected.
    registerUserLifecycleHooks('throw-1', {
      onUserDeactivated: async (_t, userId) => {
        if (userId === 999) throw new Error('boom');
      },
    });
    registerUserLifecycleHooks('throw-2', { onUserDeactivated: later });
    await expect(runUserDeactivated(tx, 999, null)).rejects.toThrow('boom');
    expect(later).not.toHaveBeenCalled();
  });
});
