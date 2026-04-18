import { Test } from '@nestjs/testing';
import { DemoTestGamesController } from './demo-test-games.controller';
import { DemoTestService } from './demo-test.service';
import { LineupSteamNudgeService } from '../lineups/lineup-steam-nudge.service';

function createMockService() {
  return {
    addGameInterestForTest: jest.fn().mockResolvedValue(undefined),
    clearGameInterestForTest: jest.fn().mockResolvedValue(undefined),
    setSteamAppIdForTest: jest.fn().mockResolvedValue(undefined),
    getGameForTest: jest.fn(),
    setAutoHeartPrefForTest: jest.fn().mockResolvedValue(undefined),
    cancelLineupPhaseJobsForTest: jest.fn().mockResolvedValue(2),
  };
}

describe('DemoTestGamesController', () => {
  let controller: DemoTestGamesController;
  let mockService: ReturnType<typeof createMockService>;
  let nudge: { nudgeUnlinkedMembers: jest.Mock };

  beforeEach(async () => {
    mockService = createMockService();
    nudge = { nudgeUnlinkedMembers: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      controllers: [DemoTestGamesController],
      providers: [
        { provide: DemoTestService, useValue: mockService },
        { provide: LineupSteamNudgeService, useValue: nudge },
      ],
    }).compile();

    controller = module.get(DemoTestGamesController);
  });

  it('addGameInterest delegates to service', async () => {
    const result = await controller.addGameInterestForTest({
      userId: 1,
      gameId: 10,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.addGameInterestForTest).toHaveBeenCalledWith(1, 10);
  });

  it('clearGameInterest delegates to service', async () => {
    const result = await controller.clearGameInterestForTest({
      userId: 1,
      gameId: 10,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.clearGameInterestForTest).toHaveBeenCalledWith(1, 10);
  });

  it('setSteamAppId delegates to service', async () => {
    const result = await controller.setSteamAppIdForTest({
      gameId: 5,
      steamAppId: 730,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.setSteamAppIdForTest).toHaveBeenCalledWith(5, 730);
  });

  it('setAutoHeartPref delegates to service (ROK-1054)', async () => {
    const result = await controller.setAutoHeartPrefForTest({
      userId: 7,
      enabled: true,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.setAutoHeartPrefForTest).toHaveBeenCalledWith(7, true);
  });

  it('setAutoHeartPref accepts enabled=false', async () => {
    const result = await controller.setAutoHeartPrefForTest({
      userId: 12,
      enabled: false,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.setAutoHeartPrefForTest).toHaveBeenCalledWith(12, false);
  });

  it('setAutoHeartPref rejects invalid userId', async () => {
    await expect(
      controller.setAutoHeartPrefForTest({
        userId: -1,
        enabled: true,
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('setAutoHeartPref rejects non-boolean enabled', async () => {
    await expect(
      controller.setAutoHeartPrefForTest({
        userId: 1,
        enabled: 'yes',
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('getGame returns game name and id (ROK-1054)', async () => {
    mockService.getGameForTest.mockResolvedValueOnce({
      id: 8363,
      name: 'Test WoW',
    });
    const result = await controller.getGameForTest({ id: 8363 });
    expect(result).toEqual({ id: 8363, name: 'Test WoW' });
    expect(mockService.getGameForTest).toHaveBeenCalledWith(8363);
  });

  it('getGame returns 404 when game not found', async () => {
    mockService.getGameForTest.mockResolvedValueOnce(null);
    await expect(controller.getGameForTest({ id: 99999 })).rejects.toThrow(
      /Game not found/,
    );
  });

  it('getGame rejects invalid id', async () => {
    await expect(controller.getGameForTest({ id: -1 })).rejects.toThrow(
      /Validation failed/,
    );
  });

  it('triggerSteamNudge delegates to LineupSteamNudgeService', async () => {
    const result = await controller.triggerSteamNudge({ lineupId: 42 });
    expect(result).toEqual({ success: true });
    expect(nudge.nudgeUnlinkedMembers).toHaveBeenCalledWith(42);
  });

  it('cancelLineupPhaseJobs delegates to service (ROK-1007)', async () => {
    const result = await controller.cancelLineupPhaseJobsForTest({
      lineupId: 7,
    });
    expect(result).toEqual({ success: true, removed: 2 });
    expect(mockService.cancelLineupPhaseJobsForTest).toHaveBeenCalledWith(7);
  });

  it('cancelLineupPhaseJobs rejects invalid body', async () => {
    await expect(
      controller.cancelLineupPhaseJobsForTest({ lineupId: -1 }),
    ).rejects.toThrow(/Validation failed/);
  });
});
