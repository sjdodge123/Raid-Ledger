import { Logger } from '@nestjs/common';
import {
  getGlobalAchievementPercentages,
  getPlayerAchievements,
  getSchemaForGame,
} from '../../../steam/steam-achievements-http.util';
import { SteamRateLimitedError } from './steam-stats.constants';
import { SteamStatsRefreshService } from './steam-stats-refresh.service';
import type { SteamStatsStorageRepository } from './steam-stats-storage.repository';
import type { SteamStatsTargetsRepository } from './steam-stats-targets.repository';
import type { SettingsService } from '../../../settings/settings.service';

jest.mock('../../../steam/steam-achievements-http.util', () => ({
  getPlayerAchievements: jest.fn(),
  getSchemaForGame: jest.fn(),
  getGlobalAchievementPercentages: jest.fn(),
}));

const APP = 1086940;
const playerMock = jest.mocked(getPlayerAchievements);
const schemaMock = jest.mocked(getSchemaForGame);
const pctMock = jest.mocked(getGlobalAchievementPercentages);
const ACH = {
  apiName: 'A1',
  name: 'One',
  description: null,
  icon: null,
  hidden: false,
};
const UNLOCKED = [
  { apiName: 'A1', unlockedAt: new Date('2026-10-01T00:00:00Z') },
];

function setup(userIds: number[], maxUserFetches = 5000) {
  const targets = {
    liveHubsByApp: jest.fn().mockResolvedValue(new Map([[APP, [10]]])),
    targetsFor: jest
      .fn()
      .mockResolvedValue(
        userIds.map((userId) => ({ userId, steamId: `s${userId}` })),
      ),
  };
  const storage = {
    hasUsableSchema: jest.fn().mockResolvedValue(true),
    markSchemaError: jest.fn().mockResolvedValue(undefined),
    saveSchema: jest.fn().mockResolvedValue(undefined),
    saveUserOk: jest.fn().mockResolvedValue(true),
    saveUserStatus: jest.fn().mockResolvedValue(true),
  };
  const settings = { getSteamApiKey: jest.fn().mockResolvedValue('KEY') };
  const service = new SteamStatsRefreshService(
    targets as unknown as SteamStatsTargetsRepository,
    storage as unknown as SteamStatsStorageRepository,
    settings as unknown as SettingsService,
    { delayMs: 0, maxUserFetches },
  );
  return { service, targets, storage, settings };
}

beforeEach(() => {
  jest.resetAllMocks();
  schemaMock.mockResolvedValue({
    kind: 'ok',
    achievements: [ACH],
    missingHidden: 0,
  });
  pctMock.mockResolvedValue({
    kind: 'ok',
    percentages: new Map([['A1', 12.5]]),
  });
  playerMock.mockResolvedValue({ kind: 'ok', unlocked: UNLOCKED });
});

describe('SteamStatsRefreshService.refreshAll', () => {
  it('R1 — a throwing user does not stop the next', async () => {
    const { service, storage } = setup([1, 2]);
    playerMock.mockRejectedValueOnce(new Error('boom'));
    await service.refreshAll();
    expect(storage.saveUserOk).toHaveBeenCalledTimes(1);
    expect(storage.saveUserOk).toHaveBeenCalledWith(
      { userId: 2, steamId: 's2' },
      APP,
      UNLOCKED,
      expect.any(Date),
    );
  });

  it('R2 — private writes the status only, unlocks untouched', async () => {
    const { service, storage } = setup([1]);
    playerMock.mockResolvedValueOnce({ kind: 'private' });
    await service.refreshAll();
    expect(storage.saveUserStatus).toHaveBeenCalledWith(
      { userId: 1, steamId: 's1' },
      APP,
      'private',
      expect.any(Date),
    );
    expect(storage.saveUserOk).not.toHaveBeenCalled();
  });

  it('R3 — ok hands the full unlock set to the storage replace', async () => {
    const { service, storage } = setup([1]);
    await service.refreshAll();
    expect(storage.saveSchema).toHaveBeenCalledWith(
      APP,
      [ACH],
      new Map([['A1', 12.5]]),
      expect.any(Date),
    );
    expect(storage.saveUserOk).toHaveBeenCalledWith(
      { userId: 1, steamId: 's1' },
      APP,
      UNLOCKED,
      expect.any(Date),
    );
  });
});

describe('SteamStatsRefreshService — Steam account swapped mid-run', () => {
  it('R7 — a skipped save (account changed) logs at debug and the run goes on', async () => {
    const { service, storage } = setup([1, 2]);
    storage.saveUserOk.mockResolvedValueOnce(false);
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    await service.refreshAll();
    expect(storage.saveUserOk).toHaveBeenNthCalledWith(
      1,
      { userId: 1, steamId: 's1' },
      APP,
      UNLOCKED,
      expect.any(Date),
    );
    expect(storage.saveUserOk).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('user 1, app 1086940 skipped'),
    );
    expect(debug).toHaveBeenCalledTimes(1);
    debug.mockRestore();
  });
});

describe('SteamStatsRefreshService.refreshAll — schema + limits', () => {
  it('R4 — a schema failure marks the app and skips its users', async () => {
    const { service, storage, targets } = setup([1]);
    schemaMock.mockResolvedValueOnce({ kind: 'error', status: 502 });
    await service.refreshAll();
    expect(storage.markSchemaError).toHaveBeenCalledWith(APP);
    expect(targets.targetsFor).not.toHaveBeenCalled();
    expect(playerMock).not.toHaveBeenCalled();
  });

  it('R4b — a schema with no achievements is stored and fetches no users', async () => {
    const { service, storage } = setup([1]);
    schemaMock.mockResolvedValueOnce({
      kind: 'ok',
      achievements: [],
      missingHidden: 0,
    });
    await service.refreshAll();
    expect(storage.saveSchema).toHaveBeenCalledWith(
      APP,
      [],
      expect.anything(),
      expect.any(Date),
    );
    expect(playerMock).not.toHaveBeenCalled();
  });

  it('R5 — a 429 on user 2 of 4 throws and users 3–4 are not fetched', async () => {
    const { service, storage } = setup([1, 2, 3, 4]);
    playerMock
      .mockResolvedValueOnce({ kind: 'ok', unlocked: UNLOCKED })
      .mockResolvedValueOnce({ kind: 'rate_limited' });
    await expect(service.refreshAll()).rejects.toBeInstanceOf(
      SteamRateLimitedError,
    );
    expect(playerMock).toHaveBeenCalledTimes(2);
    expect(storage.saveUserStatus).not.toHaveBeenCalled();
  });

  it('R6 — the run stops at the per-run fetch ceiling', async () => {
    const { service } = setup([1, 2, 3, 4], 2);
    const summary = await service.refreshAll();
    expect(playerMock).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ apps: 1, userFetches: 2, capped: true });
  });

  it('no Steam key → no Steam call at all', async () => {
    const { service, settings } = setup([1]);
    settings.getSteamApiKey.mockResolvedValue(null);
    await service.refreshAll();
    expect(schemaMock).not.toHaveBeenCalled();
    expect(playerMock).not.toHaveBeenCalled();
  });
});

describe('SteamStatsRefreshService.refreshUser (D6 on-link)', () => {
  it('fetches only that user, without re-fetching the schema', async () => {
    const { service, targets, storage } = setup([7]);
    await service.refreshUser(7);
    expect(targets.targetsFor).toHaveBeenCalledWith(APP, [10], 7);
    expect(schemaMock).not.toHaveBeenCalled();
    expect(storage.saveUserOk).toHaveBeenCalledWith(
      { userId: 7, steamId: 's7' },
      APP,
      UNLOCKED,
      expect.any(Date),
    );
  });

  it('refreshes against the last good schema after a failed schema fetch (review MAJOR 1)', async () => {
    const { service, storage } = setup([7]);
    storage.hasUsableSchema.mockResolvedValue(true);
    await service.refreshUser(7);
    expect(storage.saveUserOk).toHaveBeenCalledWith(
      { userId: 7, steamId: 's7' },
      APP,
      UNLOCKED,
      expect.any(Date),
    );
  });

  it('skips an app with no stored achievements (never fetched / no_stats)', async () => {
    const { service, storage } = setup([7]);
    storage.hasUsableSchema.mockResolvedValue(false);
    await service.refreshUser(7);
    expect(playerMock).not.toHaveBeenCalled();
  });
});
