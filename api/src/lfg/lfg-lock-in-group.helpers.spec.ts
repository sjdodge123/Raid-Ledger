/**
 * ROK-2352 — `resolveLockInGroup` / `buildGroupLockInPatch` carry the
 * Any-group instance pick (`lfgChosenGroupKey`) to the adapter.
 */
import { BadRequestException } from '@nestjs/common';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import {
  buildGroupLockInPatch,
  resolveLockInGroup,
} from './lfg-lock-in-group.helpers';
import type { LfgGroupingRegistry } from './lfg-grouping.helpers';
import type { LfgDb } from './lfg-query.helpers';

const GAME = 9;
const KNOWN = 'dungeon:36';

/** select().from().where() → `limit` for the slug, awaitable for intents. */
function fakeDb(intentIds: number[]): LfgDb {
  const where = () =>
    Object.assign(Promise.resolve(intentIds.map((id) => ({ id }))), {
      limit: () => Promise.resolve([{ slug: 'world-of-warcraft-classic' }]),
    });
  return {
    select: () => ({ from: () => ({ where }) }),
  } as unknown as LfgDb;
}

function fakeAdapter() {
  const buildLockInPatch = jest
    .fn()
    .mockResolvedValue({ carryover: new Map() });
  const describeGroup = jest.fn((_ctx: unknown, key: string) =>
    Promise.resolve(key === KNOWN ? { key } : null),
  );
  const adapter = {
    buildLockInPatch,
    describeGroup,
  } as unknown as LfgGroupingAdapter;
  const registry = {
    getAdapter: jest.fn().mockReturnValue(adapter),
  } as unknown as LfgGroupingRegistry;
  return { adapter, registry, buildLockInPatch };
}

describe('resolveLockInGroup — lfgChosenGroupKey', () => {
  it('keeps the chosen instance when locking in the Any group', async () => {
    const { registry } = fakeAdapter();
    const group = await resolveLockInGroup(
      fakeDb([]),
      registry,
      GAME,
      '',
      KNOWN,
    );
    expect(group.scope).toBe('');
    expect(group.chosenGroupKey).toBe(KNOWN);
  });

  it('ignores the chosen instance when the Lock-in names a keyed group', async () => {
    const { registry } = fakeAdapter();
    const group = await resolveLockInGroup(
      fakeDb([]),
      registry,
      GAME,
      KNOWN,
      'raid:409',
    );
    expect(group).toEqual(expect.objectContaining({ scope: KNOWN }));
    expect(group.chosenGroupKey).toBeUndefined();
  });

  it('refuses an unknown chosen instance with a 400 naming it', async () => {
    const { registry } = fakeAdapter();
    await expect(
      resolveLockInGroup(fakeDb([]), registry, GAME, '', 'dungeon:999'),
    ).rejects.toThrow(
      new BadRequestException('Unknown LFG group "dungeon:999"'),
    );
  });

  it('folds (no adapter) and drops the chosen instance', async () => {
    const registry = {
      getAdapter: jest.fn().mockReturnValue(undefined),
    } as unknown as LfgGroupingRegistry;
    const group = await resolveLockInGroup(
      fakeDb([]),
      registry,
      GAME,
      '',
      KNOWN,
    );
    expect(group).toEqual({ scope: null, adapter: null });
  });
});

describe('buildGroupLockInPatch — chosen instance reaches the adapter', () => {
  it('passes chosenGroupKey in the adapter ctx for the Any group', async () => {
    const { adapter, buildLockInPatch } = fakeAdapter();
    await buildGroupLockInPatch(fakeDb([3, 4]), GAME, {
      scope: '',
      adapter,
      chosenGroupKey: KNOWN,
    });
    expect(buildLockInPatch).toHaveBeenCalledWith(expect.anything(), {
      gameId: GAME,
      groupKey: '',
      memberIntentIds: [3, 4],
      chosenGroupKey: KNOWN,
    });
  });

  it('sends no chosenGroupKey when none was picked', async () => {
    const { adapter, buildLockInPatch } = fakeAdapter();
    await buildGroupLockInPatch(fakeDb([3]), GAME, { scope: '', adapter });
    expect(buildLockInPatch).toHaveBeenCalledWith(expect.anything(), {
      gameId: GAME,
      groupKey: '',
      memberIntentIds: [3],
    });
  });
});
