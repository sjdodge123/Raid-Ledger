import { Test } from '@nestjs/testing';
import { DemoTestGamesController } from './demo-test-games.controller';
import { DemoTestService } from './demo-test.service';
import { DemoTestLineupService } from './demo-test-lineup.service';
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

function createMockLineupService() {
  return {
    setAutoNominatePrefForTest: jest.fn().mockResolvedValue(undefined),
    createBuildingLineupForTest: jest.fn().mockResolvedValue({ lineupId: 1 }),
    nominateGameForTest: jest.fn().mockResolvedValue(undefined),
    archiveLineupForTest: jest.fn().mockResolvedValue(undefined),
    archiveActiveLineupForTest: jest.fn().mockResolvedValue(undefined),
    resetLineupsForTest: jest.fn().mockResolvedValue({ archivedCount: 3 }),
  };
}

type MockService = ReturnType<typeof createMockService>;
type MockNudge = { nudgeUnlinkedMembers: jest.Mock };
type GetController = () => DemoTestGamesController;
type GetMockService = () => MockService;
type GetMockNudge = () => MockNudge;

describe('DemoTestGamesController', () => {
  let controller: DemoTestGamesController;
  let mockService: MockService;
  let mockLineupService: ReturnType<typeof createMockLineupService>;
  let nudge: MockNudge;

  beforeEach(async () => {
    mockService = createMockService();
    mockLineupService = createMockLineupService();
    nudge = { nudgeUnlinkedMembers: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      controllers: [DemoTestGamesController],
      providers: [
        { provide: DemoTestService, useValue: mockService },
        { provide: DemoTestLineupService, useValue: mockLineupService },
        { provide: LineupSteamNudgeService, useValue: nudge },
      ],
    }).compile();

    controller = module.get(DemoTestGamesController);
  });

  const getController = () => controller;
  const getService = () => mockService;
  const getNudge = () => nudge;

  describe('addGameInterest', () =>
    addGameInterestTests(getController, getService));
  describe('clearGameInterest', () =>
    clearGameInterestTests(getController, getService));
  describe('setSteamAppId', () =>
    setSteamAppIdTests(getController, getService));
  describe('setAutoHeartPref (ROK-1054)', () =>
    setAutoHeartPrefTests(getController, getService));
  describe('getGame (ROK-1054)', () => getGameTests(getController, getService));
  describe('triggerSteamNudge', () =>
    triggerSteamNudgeTests(getController, getNudge));
  describe('cancelLineupPhaseJobs (ROK-1007)', () =>
    cancelLineupPhaseJobsTests(getController, getService));
  describe('resetLineups (ROK-1147)', () => {
    it('forwards titlePrefix to the lineup service', async () => {
      const result = await controller.resetLineupsForTest({
        titlePrefix: 'smoke-w0-lineup-decided',
      });
      expect(result).toEqual({ success: true, archivedCount: 3 });
      expect(mockLineupService.resetLineupsForTest).toHaveBeenCalledWith(
        'smoke-w0-lineup-decided',
      );
    });

    it('rejects bodies without a titlePrefix', async () => {
      await expect(controller.resetLineupsForTest({})).rejects.toThrow(
        /Validation failed/,
      );
    });

    it('rejects empty titlePrefix', async () => {
      await expect(
        controller.resetLineupsForTest({ titlePrefix: '' }),
      ).rejects.toThrow(/Validation failed/);
    });

    it('passes LIKE-special prefixes through unchanged (escaping handled by helper)', async () => {
      const result = await controller.resetLineupsForTest({
        titlePrefix: "smoke-w0%_'--",
      });
      expect(result).toEqual({ success: true, archivedCount: 3 });
      expect(mockLineupService.resetLineupsForTest).toHaveBeenCalledWith(
        "smoke-w0%_'--",
      );
    });
  });
});

function addGameInterestTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().addGameInterestForTest({
      userId: 1,
      gameId: 10,
    });
    expect(result).toEqual({ success: true });
    expect(getMock().addGameInterestForTest).toHaveBeenCalledWith(1, 10);
  });
}

function clearGameInterestTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().clearGameInterestForTest({
      userId: 1,
      gameId: 10,
    });
    expect(result).toEqual({ success: true });
    expect(getMock().clearGameInterestForTest).toHaveBeenCalledWith(1, 10);
  });
}

function setSteamAppIdTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().setSteamAppIdForTest({
      gameId: 5,
      steamAppId: 730,
    });
    expect(result).toEqual({ success: true });
    expect(getMock().setSteamAppIdForTest).toHaveBeenCalledWith(5, 730);
  });
}

function setAutoHeartPrefTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().setAutoHeartPrefForTest({
      userId: 7,
      enabled: true,
    });
    expect(result).toEqual({ success: true });
    expect(getMock().setAutoHeartPrefForTest).toHaveBeenCalledWith(7, true);
  });

  it('accepts enabled=false', async () => {
    const result = await getController().setAutoHeartPrefForTest({
      userId: 12,
      enabled: false,
    });
    expect(result).toEqual({ success: true });
    expect(getMock().setAutoHeartPrefForTest).toHaveBeenCalledWith(12, false);
  });

  it('rejects invalid userId', async () => {
    await expect(
      getController().setAutoHeartPrefForTest({
        userId: -1,
        enabled: true,
      }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('rejects non-boolean enabled', async () => {
    await expect(
      getController().setAutoHeartPrefForTest({
        userId: 1,
        enabled: 'yes',
      }),
    ).rejects.toThrow(/Validation failed/);
  });
}

function getGameTests(getController: GetController, getMock: GetMockService) {
  it('returns game name and id', async () => {
    getMock().getGameForTest.mockResolvedValueOnce({
      id: 8363,
      name: 'Test WoW',
    });
    const result = await getController().getGameForTest({ id: 8363 });
    expect(result).toEqual({ id: 8363, name: 'Test WoW' });
    expect(getMock().getGameForTest).toHaveBeenCalledWith(8363);
  });

  it('returns 404 when game not found', async () => {
    getMock().getGameForTest.mockResolvedValueOnce(null);
    await expect(getController().getGameForTest({ id: 99999 })).rejects.toThrow(
      /Game not found/,
    );
  });

  it('rejects invalid id', async () => {
    await expect(getController().getGameForTest({ id: -1 })).rejects.toThrow(
      /Validation failed/,
    );
  });
}

function triggerSteamNudgeTests(
  getController: GetController,
  getNudge: GetMockNudge,
) {
  it('delegates to LineupSteamNudgeService', async () => {
    const result = await getController().triggerSteamNudge({ lineupId: 42 });
    expect(result).toEqual({ success: true });
    expect(getNudge().nudgeUnlinkedMembers).toHaveBeenCalledWith(42);
  });
}

function cancelLineupPhaseJobsTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().cancelLineupPhaseJobsForTest({
      lineupId: 7,
    });
    expect(result).toEqual({ success: true, removed: 2 });
    expect(getMock().cancelLineupPhaseJobsForTest).toHaveBeenCalledWith(7);
  });

  it('rejects invalid body', async () => {
    await expect(
      getController().cancelLineupPhaseJobsForTest({ lineupId: -1 }),
    ).rejects.toThrow(/Validation failed/);
  });
}
