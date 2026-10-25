/**
 * ROK-1953 Codex-fix MINOR — a nightly refresh fetched account A, then the
 * user swapped to B before the save. The save must re-check `users.steam_id`
 * (FOR SHARE, same tx) and write nothing for A.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import { SteamStatsStorageRepository } from './steam-stats-storage.repository';

const APP = 1086940;
const OWNER = { userId: 1, steamId: 'A' };
const NOW = new Date('2026-10-25T00:00:00Z');
const UNLOCKED = [{ apiName: 'X', unlockedAt: NOW }];

function setup(currentSteamId: string | null): {
  db: MockDb;
  repo: SteamStatsStorageRepository;
} {
  const db = createDrizzleMock();
  db.for.mockResolvedValue([{ steamId: currentSteamId }]);
  const repo = new SteamStatsStorageRepository(
    db as unknown as ConstructorParameters<
      typeof SteamStatsStorageRepository
    >[0],
  );
  return { db, repo };
}

describe('SteamStatsStorageRepository — owner re-check', () => {
  it('saveUserOk writes nothing once the steam_id changed', async () => {
    const { db, repo } = setup('B');
    expect(await repo.saveUserOk(OWNER, APP, UNLOCKED, NOW)).toBe(false);
    expect(db.for).toHaveBeenCalledWith('share');
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('saveUserStatus writes nothing once the user unlinked', async () => {
    const { db, repo } = setup(null);
    expect(await repo.saveUserStatus(OWNER, APP, 'private', NOW)).toBe(false);
    expect(db.for).toHaveBeenCalledWith('share');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('writes when the steam_id still matches the fetched one', async () => {
    const { db, repo } = setup('A');
    expect(await repo.saveUserOk(OWNER, APP, UNLOCKED, NOW)).toBe(true);
    expect(await repo.saveUserStatus(OWNER, APP, 'private', NOW)).toBe(true);
    expect(db.insert).toHaveBeenCalledTimes(3);
  });
});
