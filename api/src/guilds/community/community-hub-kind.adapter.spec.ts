/**
 * ROK-1870 L2a — adapter wiring (D2/D4). The SQL of the live/active-hub
 * predicate is proven by the L3 integration spec; this pins the ladder and
 * the kind registration fields.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';
import {
  CommunityHubKindAdapter,
  EMPTY_COMMUNITY_HUB_RAIDS,
} from './community-hub-kind.adapter';

let db: MockDb;
let adapter: CommunityHubKindAdapter;

beforeEach(() => {
  db = createDrizzleMock();
  const asDb: unknown = db;
  adapter = new CommunityHubKindAdapter(
    asDb as PostgresJsDatabase<typeof schema>,
  );
});

describe('ROK-1870 CommunityHubKindAdapter', () => {
  it('is the core-owned game_community kind', () => {
    expect(adapter.kind).toBe('game_community');
    expect(adapter.pluginSlug).toBe('core');
  });

  it('staff resolve to leader without a lookup', async () => {
    await expect(
      adapter.resolveLadder({ id: 1, role: 'operator' }, 7),
    ).resolves.toBe('leader');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('a live row resolves to its role', async () => {
    db.where.mockResolvedValueOnce([{ role: 'officer' }]);
    await expect(
      adapter.resolveLadder({ id: 2, role: 'member' }, 7),
    ).resolves.toBe('officer');
  });

  it('no live row (left, banned, inactive hub) is a visitor', async () => {
    db.where.mockResolvedValueOnce([]);
    await expect(
      adapter.resolveLadder({ id: 2, role: 'member' }, 7),
    ).resolves.toBe('visitor');
  });

  it('isMember follows the live-row lookup', async () => {
    db.where
      .mockResolvedValueOnce([{ role: 'member' }])
      .mockResolvedValueOnce([]);
    await expect(adapter.isMember(2, 7)).resolves.toBe(true);
    await expect(adapter.isMember(3, 7)).resolves.toBe(false);
  });

  it('memberUserIds / memberGroupIds map the live rows', async () => {
    db.where
      .mockResolvedValueOnce([{ userId: 5 }, { userId: 6 }])
      .mockResolvedValueOnce([{ guildId: 7 }]);
    await expect(adapter.memberUserIds(7)).resolves.toEqual([5, 6]);
    await expect(adapter.memberGroupIds(5)).resolves.toEqual([7]);
  });

  it('has no ranks and no member-id grants (D6)', async () => {
    expect((await adapter.rankNames()).size).toBe(0);
    await expect(adapter.isLiveMember()).resolves.toBe(false);
  });

  it('raids 404s a missing hub and is empty otherwise', async () => {
    db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 7 }]);
    await expect(adapter.raids({ id: 1, role: 'member' }, 7)).rejects.toThrow(
      'Guild not found',
    );
    await expect(adapter.raids({ id: 1, role: 'member' }, 7)).resolves.toEqual(
      EMPTY_COMMUNITY_HUB_RAIDS,
    );
  });
});
