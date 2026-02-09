import { Test, TestingModule } from '@nestjs/testing';
import { SystemController } from './system.controller';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';

describe('SystemController', () => {
  let controller: SystemController;
  let mockUsersService: Partial<UsersService>;
  let mockSettingsService: Partial<SettingsService>;

  beforeEach(async () => {
    mockUsersService = {
      count: jest.fn(),
    };
    mockSettingsService = {
      isDiscordConfigured: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    controller = module.get<SystemController>(SystemController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return isFirstRun: true when no users exist (AC-4)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(0);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );

      const result = await controller.getStatus();

      expect(result.isFirstRun).toBe(true);
      expect(mockUsersService.count).toHaveBeenCalled();
    });

    it('should return isFirstRun: false when users exist (AC-4)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(5);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );

      const result = await controller.getStatus();

      expect(result.isFirstRun).toBe(false);
      expect(mockUsersService.count).toHaveBeenCalled();
    });

    it('should return discordConfigured based on settings service (AC-4)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(0);

      // Test when Discord is configured
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        true,
      );
      let result = await controller.getStatus();
      expect(result.discordConfigured).toBe(true);

      // Test when Discord is not configured
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );
      result = await controller.getStatus();
      expect(result.discordConfigured).toBe(false);
    });
  });
});
