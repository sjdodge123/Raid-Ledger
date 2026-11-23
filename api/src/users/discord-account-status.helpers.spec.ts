/**
 * ROK-2298: the shared blocked-account lookup (tri-state) and service gates.
 */
import { ForbiddenException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  ACCOUNT_BLOCKED_CODE,
  ACCOUNT_BLOCKED_REPLY,
  accountBlockReason,
  accountBlockedError,
  assertAccountActive,
  assertUserRowActive,
  isAccountBlockedError,
  loadActiveUserRow,
  resolveDiscordAccount,
} from './discord-account-status.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const BAN = new Date('2026-11-01T00:00:00Z');
const OFF = new Date('2026-11-02T00:00:00Z');

function row(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    discordId: 'd-1',
    bannedAt: null,
    deactivatedAt: null,
    ...over,
  };
}

function asDb(mock: MockDb): Db {
  // The flat chain mock stands in for the drizzle query builder.
  return mock as unknown as Db;
}

let mock: MockDb;
beforeEach(() => {
  mock = createDrizzleMock();
});

describe('accountBlockReason', () => {
  it('ban wins over deactivation', () => {
    expect(accountBlockReason({ bannedAt: BAN, deactivatedAt: OFF })).toBe(
      'banned',
    );
  });
  it('deactivated only', () => {
    expect(accountBlockReason({ bannedAt: null, deactivatedAt: OFF })).toBe(
      'deactivated',
    );
  });
  it('active', () => {
    expect(accountBlockReason({ bannedAt: null, deactivatedAt: null })).toBe(
      null,
    );
  });
});

describe('accountBlockedError / isAccountBlockedError', () => {
  it('builds a 403 carrying the ACCOUNT_BLOCKED code and the shared copy', () => {
    const err = accountBlockedError();
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toEqual({
      code: ACCOUNT_BLOCKED_CODE,
      message: ACCOUNT_BLOCKED_REPLY,
    });
    expect(isAccountBlockedError(err)).toBe(true);
  });
  it('rejects other 403s and non-errors', () => {
    expect(isAccountBlockedError(new ForbiddenException('nope'))).toBe(false);
    expect(isAccountBlockedError(new Error('x'))).toBe(false);
    expect(isAccountBlockedError(null)).toBe(false);
  });
});

describe('assertUserRowActive', () => {
  it('throws ACCOUNT_BLOCKED for a banned row', () => {
    expect(() =>
      assertUserRowActive({ bannedAt: BAN, deactivatedAt: null }),
    ).toThrow(ACCOUNT_BLOCKED_REPLY);
  });
  it('passes an active row and a missing row', () => {
    expect(() =>
      assertUserRowActive({ bannedAt: null, deactivatedAt: null }),
    ).not.toThrow();
    expect(() => assertUserRowActive(undefined)).not.toThrow();
  });
});

describe('resolveDiscordAccount', () => {
  it('linked: exact match, active', async () => {
    mock.limit.mockResolvedValueOnce([row()]);
    const res = await resolveDiscordAccount(asDb(mock), 'd-1');
    expect(res).toEqual({ kind: 'linked', user: row() });
  });
  it('blocked: exact match, deactivated', async () => {
    mock.limit.mockResolvedValueOnce([row({ deactivatedAt: OFF })]);
    const res = await resolveDiscordAccount(asDb(mock), 'd-1');
    expect(res).toMatchObject({ kind: 'blocked', reason: 'deactivated' });
  });
  it('blocked: exact match, banned', async () => {
    mock.limit.mockResolvedValueOnce([row({ bannedAt: BAN })]);
    const res = await resolveDiscordAccount(asDb(mock), 'd-1');
    expect(res).toMatchObject({ kind: 'blocked', reason: 'banned' });
  });
  it('unlinked: no row', async () => {
    mock.limit.mockResolvedValueOnce([]);
    const res = await resolveDiscordAccount(asDb(mock), 'd-1');
    expect(res).toEqual({ kind: 'unlinked' });
  });
  it('blocked: a self-unlinked account banned later (Q3)', async () => {
    mock.limit.mockResolvedValueOnce([
      row({ discordId: 'unlinked:d-1', bannedAt: BAN }),
    ]);
    const res = await resolveDiscordAccount(asDb(mock), 'd-1');
    expect(res).toMatchObject({ kind: 'blocked', reason: 'banned' });
  });
  it('unlinked: an active self-unlinked account', async () => {
    mock.limit.mockResolvedValueOnce([row({ discordId: 'unlinked:d-1' })]);
    const res = await resolveDiscordAccount(asDb(mock), 'd-1');
    expect(res).toEqual({ kind: 'unlinked' });
  });
  it('the exact match decides when both rows exist', async () => {
    mock.limit.mockResolvedValueOnce([
      row({ id: 9, discordId: 'unlinked:d-1', bannedAt: BAN }),
      row(),
    ]);
    const res = await resolveDiscordAccount(asDb(mock), 'd-1');
    expect(res).toEqual({ kind: 'linked', user: row() });
  });
});

describe('assertAccountActive', () => {
  it('throws ACCOUNT_BLOCKED for a deactivated user', async () => {
    mock.limit.mockResolvedValueOnce([{ bannedAt: null, deactivatedAt: OFF }]);
    await expect(assertAccountActive(asDb(mock), 7)).rejects.toThrow(
      ACCOUNT_BLOCKED_REPLY,
    );
  });
  it('passes an active user and an unknown id', async () => {
    mock.limit.mockResolvedValueOnce([{ bannedAt: null, deactivatedAt: null }]);
    await expect(assertAccountActive(asDb(mock), 7)).resolves.toBeUndefined();
    mock.limit.mockResolvedValueOnce([]);
    await expect(assertAccountActive(asDb(mock), 8)).resolves.toBeUndefined();
  });
});

describe('loadActiveUserRow', () => {
  it('returns the active row', async () => {
    mock.limit.mockResolvedValueOnce([row()]);
    await expect(loadActiveUserRow(asDb(mock), 7)).resolves.toEqual(row());
  });
  it('refuses a banned row', async () => {
    mock.limit.mockResolvedValueOnce([row({ bannedAt: BAN })]);
    await expect(loadActiveUserRow(asDb(mock), 7)).rejects.toThrow(
      ACCOUNT_BLOCKED_REPLY,
    );
  });
});
