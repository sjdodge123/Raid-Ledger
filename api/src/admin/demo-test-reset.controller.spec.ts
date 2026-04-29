import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DemoTestResetController } from './demo-test-reset.controller';
import {
  DemoTestResetService,
  type ResetToSeedResult,
} from './demo-test-reset.service';
import { SettingsService } from '../settings/settings.service';

function buildResetResult(
  overrides?: Partial<ResetToSeedResult>,
): ResetToSeedResult {
  return {
    success: true,
    deleted: {
      events: 5,
      signups: 12,
      lineups: 2,
      lineupEntries: 4,
      lineupVotes: 6,
      characters: 3,
      voiceSessions: 0,
      rosterAssignments: 0,
      availability: 0,
      eventPlans: 0,
      lineupAiSuggestions: 0,
      questProgress: 0,
    },
    reseed: { ok: true },
    ...overrides,
  };
}

function createMockResetService() {
  return {
    resetToSeed: jest.fn().mockResolvedValue(buildResetResult()),
  };
}

describe('DemoTestResetController', () => {
  let controller: DemoTestResetController;
  let mockReset: ReturnType<typeof createMockResetService>;
  let mockSettings: { getDemoMode: jest.Mock };
  const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

  beforeEach(async () => {
    mockReset = createMockResetService();
    mockSettings = { getDemoMode: jest.fn().mockResolvedValue(true) };
    process.env.DEMO_MODE = 'true';

    const module = await Test.createTestingModule({
      controllers: [DemoTestResetController],
      providers: [
        { provide: DemoTestResetService, useValue: mockReset },
        { provide: SettingsService, useValue: mockSettings },
      ],
    }).compile();

    controller = module.get(DemoTestResetController);
  });

  afterEach(() => {
    if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  });

  describe('POST /admin/test/reset-to-seed', () => {
    it('delegates to service and returns its result', async () => {
      const result = await controller.resetToSeed();
      expect(result).toEqual(buildResetResult());
      expect(mockReset.resetToSeed).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException when env DEMO_MODE !== "true"', async () => {
      process.env.DEMO_MODE = 'false';
      await expect(controller.resetToSeed()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockReset.resetToSeed).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when DB demoMode flag is false', async () => {
      mockSettings.getDemoMode.mockResolvedValueOnce(false);
      await expect(controller.resetToSeed()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockReset.resetToSeed).not.toHaveBeenCalled();
    });
  });
});
