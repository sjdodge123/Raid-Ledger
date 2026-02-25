import { Test, TestingModule } from '@nestjs/testing';
import { SystemController } from './system.controller';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

describe('SystemController', () => {
  let controller: SystemController;
  let mockUsersService: Partial<UsersService>;
  let mockSettingsService: Partial<SettingsService>;
  let mockPluginRegistry: Partial<PluginRegistryService>;

  beforeEach(async () => {
    mockUsersService = {
      count: jest.fn(),
    };
    mockSettingsService = {
      isDiscordConfigured: jest.fn(),
      isBlizzardConfigured: jest.fn().mockResolvedValue(false),
      getDemoMode: jest.fn().mockResolvedValue(false),
      getBranding: jest.fn().mockResolvedValue({
        communityName: null,
        communityLogoPath: null,
        communityAccentColor: null,
      }),
      get: jest.fn().mockResolvedValue(null),
    };
    mockPluginRegistry = {
      getActiveSlugsSync: jest.fn().mockReturnValue(new Set<string>()),
      getAdaptersForExtensionPoint: jest.fn().mockReturnValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: PluginRegistryService, useValue: mockPluginRegistry },
      ],
    }).compile();

    controller = module.get<SystemController>(SystemController);
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

      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        true,
      );
      let result = await controller.getStatus();
      expect(result.discordConfigured).toBe(true);

      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );
      result = await controller.getStatus();
      expect(result.discordConfigured).toBe(false);
    });

    it('should include activePlugins from plugin registry (ROK-238)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(1);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );
      (mockPluginRegistry.getActiveSlugsSync as jest.Mock).mockReturnValue(
        new Set(['some-plugin']),
      );

      const result = await controller.getStatus();

      expect(result.activePlugins).toEqual(
        expect.arrayContaining(['some-plugin']),
      );
    });

    it('should return blizzard in activePlugins when plugin is active in registry (ROK-266)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(1);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );
      (mockPluginRegistry.getActiveSlugsSync as jest.Mock).mockReturnValue(
        new Set(['blizzard']),
      );

      const result = await controller.getStatus();

      expect(result.activePlugins).toContain('blizzard');
    });

    it('should return empty activePlugins when no plugins are active (ROK-266)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(1);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );
      (mockPluginRegistry.getActiveSlugsSync as jest.Mock).mockReturnValue(
        new Set<string>(),
      );

      const result = await controller.getStatus();

      expect(result.activePlugins).toEqual([]);
    });

    it('should include authProviders from configured auth adapters (ROK-267)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(1);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        true,
      );

      const mockProvider = {
        providerKey: 'discord',
        getLoginMethod: () => ({
          key: 'discord',
          label: 'Continue with Discord',
          icon: 'discord',
          loginPath: '/auth/discord',
        }),
        isConfigured: jest.fn().mockResolvedValue(true),
      };

      (
        mockPluginRegistry.getAdaptersForExtensionPoint as jest.Mock
      ).mockReturnValue(new Map([['discord', mockProvider]]));

      const result = await controller.getStatus();

      expect(result.authProviders).toEqual([
        {
          key: 'discord',
          label: 'Continue with Discord',
          icon: 'discord',
          loginPath: '/auth/discord',
        },
      ]);
    });

    it('should exclude unconfigured auth providers from authProviders (ROK-267)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(1);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );

      const mockProvider = {
        providerKey: 'discord',
        getLoginMethod: () => ({
          key: 'discord',
          label: 'Continue with Discord',
          icon: 'discord',
          loginPath: '/auth/discord',
        }),
        isConfigured: jest.fn().mockResolvedValue(false),
      };

      (
        mockPluginRegistry.getAdaptersForExtensionPoint as jest.Mock
      ).mockReturnValue(new Map([['discord', mockProvider]]));

      const result = await controller.getStatus();

      expect(result.authProviders).toEqual([]);
    });

    it('should return empty authProviders when no auth adapters registered (ROK-267)', async () => {
      (mockUsersService.count as jest.Mock).mockResolvedValue(1);
      (mockSettingsService.isDiscordConfigured as jest.Mock).mockResolvedValue(
        false,
      );

      const result = await controller.getStatus();

      expect(result.authProviders).toEqual([]);
    });
  });
});
