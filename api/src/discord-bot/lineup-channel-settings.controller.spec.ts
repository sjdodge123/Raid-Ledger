/**
 * TDD tests for LineupChannelSettingsController (ROK-932).
 * Validates GET/PUT lineup channel admin endpoints.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LineupChannelSettingsController } from './lineup-channel-settings.controller';
import { SettingsService } from '../settings/settings.service';

function makeMockSettingsService() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
}

describe('LineupChannelSettingsController', () => {
  let controller: LineupChannelSettingsController;
  let mockSettings: ReturnType<typeof makeMockSettingsService>;

  beforeEach(async () => {
    mockSettings = makeMockSettingsService();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LineupChannelSettingsController],
      providers: [{ provide: SettingsService, useValue: mockSettings }],
    }).compile();

    controller = module.get(LineupChannelSettingsController);
  });

  describe('GET /lineup-channel', () => {
    it('returns null when no lineup channel configured', async () => {
      const result = await controller.getLineupChannel();

      expect(result).toEqual({ channelId: null });
    });

    it('returns channel ID when lineup channel is configured', async () => {
      mockSettings.get.mockResolvedValue('chan-lineup');

      const result = await controller.getLineupChannel();

      expect(result).toEqual({ channelId: 'chan-lineup' });
    });
  });

  describe('PUT /lineup-channel', () => {
    it('sets the lineup channel and returns success', async () => {
      const result = await controller.setLineupChannel({
        channelId: 'chan-123',
      });

      expect(mockSettings.set).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Lineup channel updated.',
      });
    });

    it('validates channelId is provided', async () => {
      await expect(
        controller.setLineupChannel({} as { channelId: string }),
      ).rejects.toThrow();
    });
  });
});
