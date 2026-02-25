import { Test, TestingModule } from '@nestjs/testing';
import { DiscordAuthService } from './discord-auth.service';
import { SettingsService } from '../../settings/settings.service';

describe('DiscordAuthService', () => {
  let service: DiscordAuthService;
  let mockSettingsService: { isDiscordConfigured: jest.Mock };

  beforeEach(async () => {
    mockSettingsService = {
      isDiscordConfigured: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordAuthService,
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get<DiscordAuthService>(DiscordAuthService);
  });

  describe('providerKey', () => {
    it('should return "discord"', () => {
      expect(service.providerKey).toBe('discord');
    });
  });

  describe('getLoginMethod', () => {
    it('should return a LoginMethod with correct fields', () => {
      const method = service.getLoginMethod();

      expect(method).toEqual({
        key: 'discord',
        label: 'Continue with Discord',
        icon: 'discord',
        loginPath: '/auth/discord',
      });
    });
  });

  describe('isConfigured', () => {
    it('should return true when Discord OAuth is configured', async () => {
      mockSettingsService.isDiscordConfigured.mockResolvedValueOnce(true);

      const result = await service.isConfigured();

      expect(result).toBe(true);
      expect(mockSettingsService.isDiscordConfigured).toHaveBeenCalled();
    });

    it('should return false when Discord OAuth is not configured', async () => {
      mockSettingsService.isDiscordConfigured.mockResolvedValueOnce(false);

      const result = await service.isConfigured();

      expect(result).toBe(false);
    });
  });
});
