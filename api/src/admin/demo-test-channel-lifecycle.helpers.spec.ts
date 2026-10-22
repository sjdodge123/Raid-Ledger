/**
 * ROK-1432 (L6b) — unit coverage for the channel-lifecycle DEMO seed helpers.
 * The DB writes are covered by shape (drizzle-mock); the real joins live in
 * the lifecycle integration specs.
 */
import { NotFoundException } from '@nestjs/common';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import {
  AgeBindingSchema,
  ChannelLifecycleSeedSchema,
  ageBinding,
  bindingLifecycleSet,
  ensureSeedGame,
  fakeSnowflake,
  seedEvents,
} from './demo-test-channel-lifecycle.helpers';

jest.mock('../igdb/igdb-name-dedup.helpers', () => ({
  findGameByNormalizedName: jest.fn(),
}));

const findGame = jest.mocked(findGameByNormalizedName);
const NOW = new Date('2026-10-20T12:00:00Z');
type Db = Parameters<typeof ensureSeedGame>[0];
/** The project's drizzle-mock convention: one cast at the seam. */
const asDb = (m: MockDb): Db => m as unknown as Db;

let db: MockDb;
beforeEach(() => {
  db = createDrizzleMock();
  findGame.mockReset();
});

describe('ChannelLifecycleSeedSchema', () => {
  it('defaults an empty body to one game with no items and no binding', () => {
    const input = ChannelLifecycleSeedSchema.parse({});
    expect(input.gameName).toBe('Lifecycle Demo Game');
    expect(input.items).toEqual({
      events: 0,
      adHocEvents: 0,
      polls: 0,
      eventPlans: 0,
      lineupVotes: 0,
    });
    expect(input.binding).toEqual({
      state: 'none',
      pinned: false,
      autoManaged: true,
    });
    expect(input.suppression).toBeNull();
    expect(input.serverHubWithoutChannel).toBe(false);
  });

  it('refuses an archived binding that is not auto-managed', () => {
    const r = ChannelLifecycleSeedSchema.safeParse({
      binding: { state: 'archived', autoManaged: false },
    });
    expect(r.success).toBe(false);
  });

  it('refuses a pinned manual binding (PIN_MANUAL_REFUSED rule)', () => {
    const r = ChannelLifecycleSeedSchema.safeParse({
      binding: { state: 'active', autoManaged: false, pinned: true },
    });
    expect(r.success).toBe(false);
  });
});

describe('AgeBindingSchema', () => {
  it('requires a uuid and a positive day count', () => {
    expect(
      AgeBindingSchema.safeParse({ bindingId: 'x', daysAgo: 3 }).success,
    ).toBe(false);
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      AgeBindingSchema.safeParse({ bindingId: id, daysAgo: 0 }).success,
    ).toBe(false);
    expect(
      AgeBindingSchema.safeParse({ bindingId: id, daysAgo: 40 }).success,
    ).toBe(true);
  });
});

describe('fakeSnowflake', () => {
  it('is a 19-digit snowflake-shaped string, unique per call', () => {
    const a = fakeSnowflake();
    expect(a).toMatch(/^\d{19}$/);
    expect(fakeSnowflake()).not.toBe(a);
  });
});

describe('bindingLifecycleSet', () => {
  it('archived: stamps archivedAt and a restore parent', () => {
    const set = bindingLifecycleSet(
      { state: 'archived', pinned: false, autoManaged: true },
      NOW,
    );
    expect(set.lifecycleState).toBe('archived');
    expect(set.autoManaged).toBe(true);
    expect(set.archivedAt).toEqual(NOW);
    expect(set.restoreParentId).toMatch(/^\d{19}$/);
  });

  it('active: clears archivedAt and the restore parent', () => {
    const set = bindingLifecycleSet(
      { state: 'active', pinned: true, autoManaged: true },
      NOW,
    );
    expect(set).toEqual({
      lifecycleState: 'active',
      autoManaged: true,
      pinned: true,
      archivedAt: null,
      restoreParentId: null,
      updatedAt: NOW,
    });
  });
});

describe('ensureSeedGame', () => {
  it('reuses the game the name-dedup guard finds (idempotent re-POST)', async () => {
    findGame.mockResolvedValue({
      id: 7,
      name: 'Lifecycle Demo Game',
      igdbId: null,
      steamAppId: null,
      itadGameId: null,
    });
    const game = await ensureSeedGame(asDb(db), 'Lifecycle Demo Game');
    expect(game).toEqual({ id: 7, name: 'Lifecycle Demo Game' });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalled(); // advisory lock taken
  });

  it('inserts inside the name lock when no game matches', async () => {
    findGame.mockResolvedValue(null);
    db.returning.mockResolvedValueOnce([{ id: 9, name: 'New Game' }]);
    const game = await ensureSeedGame(asDb(db), 'New Game');
    expect(game).toEqual({ id: 9, name: 'New Game' });
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Game', igdbId: null }),
    );
  });
});

describe('seedEvents', () => {
  it('inserts scheduled events then ad-hoc ones, returning every id', async () => {
    db.returning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const ids = await seedEvents(
      asDb(db),
      { gameId: 7, creatorId: 4, now: NOW },
      2,
      1,
    );
    expect(ids).toEqual([1, 2, 3]);
    const rows: unknown = db.values.mock.calls[0]?.[0];
    expect(rows).toEqual([
      expect.objectContaining({ gameId: 7, creatorId: 4, isAdHoc: false }),
      expect.objectContaining({ isAdHoc: false }),
      expect.objectContaining({ isAdHoc: true }),
    ]);
  });

  it('writes nothing when no events are asked for', async () => {
    expect(
      await seedEvents(asDb(db), { gameId: 7, creatorId: 4, now: NOW }, 0, 0),
    ).toEqual([]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('ageBinding', () => {
  it('404s an unknown binding', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(
      ageBinding(asDb(db), { bindingId: 'b', daysAgo: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shifts the binding and its game activity back', async () => {
    db.limit.mockResolvedValueOnce([{ id: 'b', gameId: 7 }]);
    const r = await ageBinding(asDb(db), { bindingId: 'b', daysAgo: 10 });
    expect(r).toEqual({ bindingId: 'b', gameId: 7, shiftedDays: 10 });
    // binding + events + match + slot votes + plans + lineup votes
    expect(db.update).toHaveBeenCalledTimes(6);
  });

  it('backdates every timestamp a signal reads (Codex r5: vote updatedAt, plan pollStartedAt)', async () => {
    db.limit.mockResolvedValueOnce([{ id: 'b', gameId: 7 }]);
    await ageBinding(asDb(db), { bindingId: 'b', daysAgo: 10 });
    const setKeys = (db.set as jest.Mock).mock.calls.map((c: unknown[]) =>
      Object.keys(c[0] as object).sort(),
    );
    expect(setKeys).toContainEqual(['createdAt', 'updatedAt']);
    expect(setKeys).toContainEqual(['createdAt', 'pollStartedAt']);
  });
});
