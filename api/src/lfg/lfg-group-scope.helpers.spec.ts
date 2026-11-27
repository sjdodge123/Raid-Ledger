/**
 * ROK-2352 — the pure half of the group-scope rules: which hands a read or a
 * withdraw covers, and the fold's one-member-per-user de-dupe.
 */
import { BadRequestException } from '@nestjs/common';
import type {
  LfgGroupDescriptor,
  LfgGroupingAdapter,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import {
  dedupeMembersByUser,
  groupScopeFilter,
  membersForScope,
  resolveDetailGroup,
  resolveGameReadScope,
  resolveReadGroupScope,
  resolveWithdrawScope,
} from './lfg-group-scope.helpers';

const DUNGEON: LfgGroupDescriptor = {
  key: 'dungeon:36',
  label: 'Deadmines',
  kind: 'dungeon',
  size: 5,
};

/** An adapter that knows exactly one group. */
function oneGroupAdapter(): LfgGroupingAdapter {
  return {
    behaviourId: 'test-lfg-grouping',
    listGroups: jest.fn().mockResolvedValue([DUNGEON]),
    describeGroup: jest.fn((_ctx, key: string) =>
      Promise.resolve(key === DUNGEON.key ? DUNGEON : null),
    ),
    saveHandDetail: jest.fn(),
    readMemberDetails: jest.fn(),
    buildLockInPatch: jest.fn(),
    buildCarryover: jest.fn(),
  };
}

const CTX = { gameId: 7, gameSlug: 'wow-classic' };

describe('groupScopeFilter', () => {
  it('adds no clause for the whole game, one clause for a key', () => {
    expect(groupScopeFilter(null)).toBeUndefined();
    expect(groupScopeFilter('')).toBeDefined();
    expect(groupScopeFilter('dungeon:36')).toBeDefined();
  });
});

describe('resolveReadGroupScope / resolveWithdrawScope', () => {
  const adapter = oneGroupAdapter();

  it('folds to the whole game without an adapter, whatever was asked', () => {
    expect(resolveReadGroupScope(null, 'dungeon:36')).toBeNull();
    expect(resolveWithdrawScope(null, '')).toBeNull();
  });

  it('reads the requested key, defaulting to "" (any)', () => {
    expect(resolveReadGroupScope(adapter, 'dungeon:36')).toBe('dungeon:36');
    expect(resolveReadGroupScope(adapter, undefined)).toBe('');
  });

  it('withdraw `*` clears every hand; a key clears only that group', () => {
    expect(resolveWithdrawScope(adapter, '*')).toBeNull();
    expect(resolveWithdrawScope(adapter, 'dungeon:36')).toBe('dungeon:36');
    expect(resolveWithdrawScope(adapter, undefined)).toBe('');
  });

  it('resolveGameReadScope asks the registry for the slug', () => {
    const getAdapter = jest.fn().mockReturnValue(adapter);
    expect(resolveGameReadScope({ getAdapter }, 'wow', 'dungeon:36')).toBe(
      'dungeon:36',
    );
    expect(getAdapter).toHaveBeenCalledWith(expect.any(String), 'wow');
    getAdapter.mockReturnValue(undefined);
    expect(resolveGameReadScope({ getAdapter }, 'wow', 'dungeon:36')).toBe(
      null,
    );
  });
});

describe('resolveDetailGroup', () => {
  it('folded game: whole-game scope, no label, no describe', async () => {
    await expect(resolveDetailGroup(null, CTX, 'dungeon:36')).resolves.toEqual({
      scope: null,
      label: null,
    });
  });

  it('labels a known key and 400s an unknown one', async () => {
    const adapter = oneGroupAdapter();
    const known = await resolveDetailGroup(adapter, CTX, 'dungeon:36');
    expect(known).toMatchObject({ scope: 'dungeon:36', label: 'Deadmines' });
    await expect(known.describe?.('dungeon:36')).resolves.toBe('Deadmines');
    await expect(known.describe?.('')).resolves.toBeNull();
    await expect(
      resolveDetailGroup(adapter, CTX, 'dungeon:999'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the "any" group has no label and never asks the adapter', async () => {
    const adapter = oneGroupAdapter();
    const any = await resolveDetailGroup(adapter, CTX, undefined);
    expect(any).toMatchObject({ scope: '', label: null });
    expect(adapter.describeGroup).not.toHaveBeenCalled();
  });
});

describe('dedupeMembersByUser / membersForScope (the fold)', () => {
  const rows = [
    { userId: 1, expiresAt: '2026-11-27T00:00:00.000Z', groupKey: '' },
    { userId: 2, expiresAt: '2026-11-26T00:00:00.000Z', groupKey: '' },
    { userId: 1, expiresAt: '2026-11-25T12:00:00.000Z', groupKey: 'raid:1' },
    { userId: 1, expiresAt: '2026-11-26T12:00:00.000Z', groupKey: 'x:1' },
  ];

  it('keeps one row per user — the soonest-expiring hand wins', () => {
    const out = dedupeMembersByUser(rows);
    expect(out.map((r) => [r.userId, r.groupKey])).toEqual([
      [1, 'raid:1'],
      [2, ''],
    ]);
  });

  it('keeps first-seen order (the roster is oldest-intent first)', () => {
    const out = dedupeMembersByUser([...rows].reverse());
    expect(out.map((r) => r.userId)).toEqual([1, 2]);
  });

  it('only the fold de-dupes; a single group passes through', () => {
    expect(membersForScope(rows, null)).toHaveLength(2);
    expect(membersForScope(rows, 'raid:1')).toBe(rows);
  });
});
