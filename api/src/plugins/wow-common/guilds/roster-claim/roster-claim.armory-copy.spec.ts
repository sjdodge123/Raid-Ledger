/**
 * ROK-2133 AC-9 (unit) — the claim copies the member's verified Armory
 * snapshot onto the new character, and a copy failure never fails the claim.
 * The real-DB path is proven in roster-claim-armory.integration.spec.ts.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../../../common/testing/drizzle-mock';
import type { MemberArmorySnapshot } from '../../forever-armory-snapshot/snapshot.helpers';
import { copyMemberArmory } from './roster-claim.armory-copy';

const SYNCED = new Date('2026-11-07T10:00:00.000Z');
const ROW = { id: 'char-1', gameVariant: null };
const FRESH = { id: 'char-1', gameVariant: 'wow_forever' };

function snapshot(
  over: Partial<MemberArmorySnapshot> = {},
): MemberArmorySnapshot {
  return {
    blizzardCharacterId: 777,
    level: 60,
    class: 'Warrior',
    race: 'Human',
    spec: 'Protection',
    role: 'tank',
    itemLevel: 64,
    avatarUrl: null,
    equipment: null,
    talents: null,
    armoryProfessions: null,
    lastLoginAt: null,
    syncedAt: SYNCED,
    ...over,
  };
}

const member = (blizzardCharacterId: number | null) => ({
  memberId: 9,
  blizzardCharacterId,
});

describe('copyMemberArmory (ROK-2133 AC-9)', () => {
  let db: MockDb;
  const logger = { warn: jest.fn() };
  beforeEach(() => {
    db = createDrizzleMock();
    logger.warn.mockReset();
  });

  it('copies a snapshot verified against the member id and returns the re-read row', async () => {
    db.limit.mockResolvedValueOnce([snapshot()]).mockResolvedValueOnce([FRESH]);
    db.returning.mockResolvedValueOnce([{ id: 'char-1' }]);
    const got = await copyMemberArmory(db as never, member(777), ROW, logger);
    expect(got).toBe(FRESH);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        gameVariant: 'wow_forever',
        externalId: '777',
        lastSyncedAt: SYNCED,
        spec: 'Protection',
        itemLevel: 64,
      }),
    );
  });

  it('does not copy a snapshot verified against a different Blizzard id', async () => {
    db.limit.mockResolvedValueOnce([snapshot({ blizzardCharacterId: 778 })]);
    const got = await copyMemberArmory(db as never, member(777), ROW, logger);
    expect(got).toBe(ROW);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('reads nothing for a member without a Blizzard id', async () => {
    const got = await copyMemberArmory(db as never, member(null), ROW, logger);
    expect(got).toBe(ROW);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('keeps the row when the member has no snapshot', async () => {
    db.limit.mockResolvedValueOnce([]);
    const got = await copyMemberArmory(db as never, member(777), ROW, logger);
    expect(got).toBe(ROW);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('keeps the row without a re-read when the CAS copy matched nothing', async () => {
    db.limit.mockResolvedValueOnce([snapshot()]);
    db.returning.mockResolvedValueOnce([]);
    const got = await copyMemberArmory(db as never, member(777), ROW, logger);
    expect(got).toBe(ROW);
    expect(db.limit).toHaveBeenCalledTimes(1);
  });

  it('a failing copy is logged and never throws', async () => {
    db.limit.mockRejectedValueOnce(new Error('db down'));
    const got = await copyMemberArmory(db as never, member(777), ROW, logger);
    expect(got).toBe(ROW);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('db down'),
    );
  });
});
