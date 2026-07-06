import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  KICK_COOLDOWN_MS,
  USER_SUSPENDED_CODE,
  assertNotBanned,
  assertKickCooldownOrClear,
  suspendedMessage,
  kickCooldownMessage,
  isKickExpired,
} from './auth-status.helpers';
import {
  setCachedAuthUser,
  getCachedAuthUser,
  clearAuthUserCache,
} from './auth-user-cache';

type Db = PostgresJsDatabase<typeof schema>;

/** Fluent mock for `db.update(users).set({...}).where(...)`. */
function mockUpdateDb() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  return { db: { update } as unknown as Db, update, set, where };
}

afterEach(() => clearAuthUserCache());

describe('KICK_COOLDOWN_MS', () => {
  it('is 5 minutes in milliseconds', () => {
    expect(KICK_COOLDOWN_MS).toBe(5 * 60 * 1000);
  });
});

describe('suspendedMessage', () => {
  it('appends the reason when present', () => {
    expect(suspendedMessage('spamming')).toBe(
      'Your account has been suspended: spamming',
    );
  });

  it('omits the colon/suffix when reason is null', () => {
    expect(suspendedMessage(null)).toBe('Your account has been suspended');
  });
});

describe('kickCooldownMessage / isKickExpired math', () => {
  it('rounds remaining minutes up (2 min elapsed → 3 remaining)', () => {
    const kickedAt = new Date(Date.now() - 2 * 60_000);
    expect(kickCooldownMessage(kickedAt)).toContain('3 minute(s)');
  });

  it('reports at least 1 minute while still inside the window', () => {
    const kickedAt = new Date(Date.now() - (KICK_COOLDOWN_MS - 500));
    expect(kickCooldownMessage(kickedAt)).toContain('1 minute(s)');
  });

  it('isKickExpired is false inside the window, true past it', () => {
    expect(isKickExpired(new Date(Date.now() - 60_000))).toBe(false);
    expect(isKickExpired(new Date(Date.now() - KICK_COOLDOWN_MS - 1))).toBe(
      true,
    );
  });
});

describe('assertNotBanned', () => {
  it('does nothing for a non-banned user', () => {
    expect(() =>
      assertNotBanned({ bannedAt: null, banReason: null }),
    ).not.toThrow();
  });

  it('throws a structured USER_SUSPENDED ForbiddenException with reason', () => {
    let caught: ForbiddenException | undefined;
    try {
      assertNotBanned({ bannedAt: new Date(), banReason: 'cheating' });
    } catch (err) {
      caught = err as ForbiddenException;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect(caught!.getResponse()).toEqual({
      code: USER_SUSPENDED_CODE,
      message: 'Your account has been suspended: cheating',
      reason: 'cheating',
    });
  });

  it('threads a null reason through the structured response', () => {
    let caught: ForbiddenException | undefined;
    try {
      assertNotBanned({ bannedAt: new Date(), banReason: null });
    } catch (err) {
      caught = err as ForbiddenException;
    }
    expect(caught!.getResponse()).toEqual({
      code: USER_SUSPENDED_CODE,
      message: 'Your account has been suspended',
      reason: null,
    });
  });
});

describe('assertKickCooldownOrClear', () => {
  it('does nothing (no DB write) when the user was never kicked', async () => {
    const { db, update } = mockUpdateDb();
    await expect(
      assertKickCooldownOrClear(db, { id: 1, kickedAt: null }),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('throws 401 with remaining minutes while inside the cooldown', async () => {
    const { db, update } = mockUpdateDb();
    const kickedAt = new Date(Date.now() - 60_000);
    await expect(
      assertKickCooldownOrClear(db, { id: 7, kickedAt }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Still inside the window → no clear write.
    expect(update).not.toHaveBeenCalled();
  });

  it('clears kick + invalidates cache + resolves once the cooldown elapsed', async () => {
    const { db, update, set } = mockUpdateDb();
    // Prime the cache so we can prove clear-then-invalidate ran.
    setCachedAuthUser(9, {
      role: 'member',
      discordId: null,
      deactivatedAt: null,
      kickedAt: new Date(Date.now() - KICK_COOLDOWN_MS - 1),
      bannedAt: null,
      banReason: null,
    });
    const kickedAt = new Date(Date.now() - KICK_COOLDOWN_MS - 1);

    await expect(
      assertKickCooldownOrClear(db, { id: 9, kickedAt }),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ kickedAt: null, kickReason: null });
    // invalidateAuthUser(9) ran after the UPDATE.
    expect(getCachedAuthUser(9)).toBeNull();
  });
});
