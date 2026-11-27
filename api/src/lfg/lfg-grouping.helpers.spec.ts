/**
 * ROK-2352 §3.7 / Q2 — the fold rule and the per-user hand cap.
 */
import { BadRequestException } from '@nestjs/common';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import {
  assertHandCap,
  resolveLfgGrouping,
  resolveWriteGroupKey,
  type LfgGroupingRegistry,
} from './lfg-grouping.helpers';
import type { LfgDb } from './lfg-query.helpers';
import { LFG_HAND_CAP_CODE, LFG_MAX_HANDS_PER_GAME } from './lfg.constants';

const CTX = { gameId: 3, gameSlug: 'world-of-warcraft-classic' };

function adapter(known: string[]): LfgGroupingAdapter {
  return {
    behaviourId: 'wow-instance-lfg',
    listGroups: jest.fn(),
    describeGroup: jest.fn((_ctx: unknown, key: string) =>
      Promise.resolve(
        known.includes(key)
          ? { key, label: key, kind: 'dungeon' as const, size: 5 }
          : null,
      ),
    ),
    saveHandDetail: jest.fn(),
    readMemberDetails: jest.fn(),
    buildLockInPatch: jest.fn(),
    buildCarryover: jest.fn(),
  };
}

describe('resolveLfgGrouping', () => {
  it('asks the registry for the lfg-grouping adapter of the game slug', () => {
    const a = adapter([]);
    const getAdapter = jest.fn().mockReturnValue(a);
    const registry = { getAdapter } as unknown as LfgGroupingRegistry;
    expect(resolveLfgGrouping(registry, CTX.gameSlug)).toBe(a);
    expect(getAdapter).toHaveBeenCalledWith(
      EXTENSION_POINTS.LFG_GROUPING,
      CTX.gameSlug,
    );
  });

  it('is null when no active adapter serves the slug (plugin off → fold)', () => {
    const registry = {
      getAdapter: jest.fn().mockReturnValue(undefined),
    } as unknown as LfgGroupingRegistry;
    expect(resolveLfgGrouping(registry, 'valheim')).toBeNull();
  });
});

describe('resolveWriteGroupKey', () => {
  it('folds any requested key to "" when no adapter is active (never a 400)', async () => {
    await expect(resolveWriteGroupKey(null, CTX, 'dungeon:42')).resolves.toBe(
      '',
    );
  });

  it('keeps "" / absent as the whole-game group without asking the adapter', async () => {
    const a = adapter([]);
    await expect(resolveWriteGroupKey(a, CTX, undefined)).resolves.toBe('');
    await expect(resolveWriteGroupKey(a, CTX, '')).resolves.toBe('');
    expect(a.describeGroup).not.toHaveBeenCalled();
  });

  it('passes a key the adapter knows through unchanged', async () => {
    const a = adapter(['dungeon:42']);
    await expect(resolveWriteGroupKey(a, CTX, 'dungeon:42')).resolves.toBe(
      'dungeon:42',
    );
  });

  it('rejects a key the active adapter does not know with a 400', async () => {
    await expect(
      resolveWriteGroupKey(adapter(['dungeon:42']), CTX, 'raid:9'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('assertHandCap (Q2)', () => {
  it('caps live hands per user per game at 5', () => {
    expect(LFG_MAX_HANDS_PER_GAME).toBe(5);
  });

  it('allows a hand while the user holds 4 live hands in other groups', async () => {
    const db = createDrizzleMock();
    db.where.mockResolvedValueOnce([{ n: 4 }]);
    await expect(
      assertHandCap(db as unknown as LfgDb, 1, 3, 'dungeon:42'),
    ).resolves.toBeUndefined();
  });

  it('refuses the 6th live hand with a 400 carrying the cap code (spec AC3)', async () => {
    const db = createDrizzleMock();
    db.where.mockResolvedValueOnce([{ n: 5 }]);
    const err: unknown = await assertHandCap(
      db as unknown as LfgDb,
      1,
      3,
      'dungeon:42',
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getStatus()).toBe(400);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: LFG_HAND_CAP_CODE,
    });
  });
});
