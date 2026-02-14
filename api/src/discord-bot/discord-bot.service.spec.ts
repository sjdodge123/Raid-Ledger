import { Test, TestingModule } from '@nestjs/testing';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService, SETTINGS_EVENTS } from '../settings/settings.service';

describe('DiscordBotService', () => {
  let service: DiscordBotService;
  let clientService: DiscordBotClientService;
  let settingsService: SettingsService;

  const mockDiscordBotConfig = {
    token: 'test-bot-token',
    enabled: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordBotService,
        {
          provide: DiscordBotClientService,
          useValue: {
            connect: jest.fn(),
            disconnect: jest.fn(),
            isConnected: jest.fn(),
            getGuildInfo: jest.fn(),
            sendDirectMessage: jest.fn(),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getDiscordBotConfig: jest.fn(),
            isDiscordBotConfigured: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DiscordBotService>(DiscordBotService);
    clientService = module.get<DiscordBotClientService>(
      DiscordBotClientService,
    );
    settingsService = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should auto-connect when configured and enabled', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(mockDiscordBotConfig);

      await service.onModuleInit();

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(clientService.connect).toHaveBeenCalledWith(
        mockDiscordBotConfig.token,
      );
    });

    it('should not connect when config is null', async () => {
      jest.spyOn(settingsService, 'getDiscordBotConfig').mockResolvedValue(null);

      await service.onModuleInit();

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should not connect when enabled is false', async () => {
      jest.spyOn(settingsService, 'getDiscordBotConfig').mockResolvedValue({
        token: 'test-token',
        enabled: false,
      });

      await service.onModuleInit();

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should handle connection errors without crashing', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(mockDiscordBotConfig);
      jest
        .spyOn(clientService, 'connect')
        .mockRejectedValue(new Error('Connection failed'));

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();

      expect(clientService.connect).toHaveBeenCalled();
    });

    it('should handle settings service errors without crashing', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();

      expect(clientService.connect).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect gracefully on shutdown', async () => {
      await service.onModuleDestroy();

      expect(clientService.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleConfigUpdate', () => {
    it('should reconnect when config is updated with enabled=true', async () => {
      await service.handleConfigUpdate(mockDiscordBotConfig);

      expect(clientService.connect).toHaveBeenCalledWith(
        mockDiscordBotConfig.token,
      );
    });

    it('should disconnect when config is null', async () => {
      await service.handleConfigUpdate(null);

      expect(clientService.disconnect).toHaveBeenCalled();
      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should disconnect when enabled is false', async () => {
      await service.handleConfigUpdate({
        token: 'test-token',
        enabled: false,
      });

      expect(clientService.disconnect).toHaveBeenCalled();
      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should handle reconnection errors without crashing', async () => {
      jest
        .spyOn(clientService, 'connect')
        .mockRejectedValue(new Error('Reconnection failed'));

      // Should not throw
      await expect(
        service.handleConfigUpdate(mockDiscordBotConfig),
      ).resolves.not.toThrow();

      expect(clientService.connect).toHaveBeenCalled();
    });
  });

  describe('sendDm', () => {
    it('should delegate to client service', async () => {
      const discordId = '123456789';
      const content = 'Test message';

      await service.sendDm(discordId, content);

      expect(clientService.sendDirectMessage).toHaveBeenCalledWith(
        discordId,
        content,
      );
    });

    it('should propagate errors from client service', async () => {
      const error = new Error('User not found');
      jest.spyOn(clientService, 'sendDirectMessage').mockRejectedValue(error);

      await expect(service.sendDm('123', 'Hello')).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('getStatus', () => {
    it('should return status when configured and connected', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotConfigured')
        .mockResolvedValue(true);
      jest.spyOn(clientService, 'isConnected').mockReturnValue(true);
      jest.spyOn(clientService, 'getGuildInfo').mockReturnValue({
        name: 'Test Guild',
        memberCount: 100,
      });

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: true,
        guildName: 'Test Guild',
        memberCount: 100,
      });
    });

    it('should return status when configured but not connected', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotConfigured')
        .mockResolvedValue(true);
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: false,
        guildName: undefined,
        memberCount: undefined,
      });
    });

    it('should return status when not configured', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotConfigured')
        .mockResolvedValue(false);
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: false,
        connected: false,
        guildName: undefined,
        memberCount: undefined,
      });
    });

    it('should handle null guild info', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotConfigured')
        .mockResolvedValue(true);
      jest.spyOn(clientService, 'isConnected').mockReturnValue(true);
      jest.spyOn(clientService, 'getGuildInfo').mockReturnValue(null);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: true,
        guildName: undefined,
        memberCount: undefined,
      });
    });
  });

  describe('testToken', () => {
    it('should return success when token is valid and bot is in guilds', async () => {
      // Mock the test client that will be created internally
      const mockTestClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        getGuildInfo: jest.fn().mockReturnValue({
          name: 'Test Guild',
          memberCount: 50,
        }),
      };

      // We need to mock the DiscordBotClientService constructor
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockResolvedValue(undefined);
      jest.spyOn(DiscordBotClientService.prototype, 'disconnect').mockResolvedValue();
      jest.spyOn(DiscordBotClientService.prototype, 'getGuildInfo').mockReturnValue({
        name: 'Test Guild',
        memberCount: 50,
      });

      const result = await service.testToken('valid-token');

      expect(result).toEqual({
        success: true,
        guildName: 'Test Guild',
        message: 'Connected to Test Guild (50 members)',
      });
    });

    it('should return success when token is valid but not in guilds', async () => {
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockResolvedValue(undefined);
      jest.spyOn(DiscordBotClientService.prototype, 'disconnect').mockResolvedValue();
      jest.spyOn(DiscordBotClientService.prototype, 'getGuildInfo').mockReturnValue(null);

      const result = await service.testToken('valid-token-no-guilds');

      expect(result).toEqual({
        success: true,
        guildName: undefined,
        message: 'Bot token is valid but not in any guilds',
      });
    });

    it('should return failure when token is invalid', async () => {
      const error = new Error('Invalid token');
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockRejectedValue(error);

      const result = await service.testToken('invalid-token');

      expect(result).toEqual({
        success: false,
        message: 'Invalid token',
      });
    });

    it('should handle non-Error exceptions', async () => {
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockRejectedValue('String error');

      const result = await service.testToken('bad-token');

      expect(result).toEqual({
        success: false,
        message: 'Failed to connect with provided token',
      });
    });

    it('should disconnect test client even on success', async () => {
      const disconnectSpy = jest
        .spyOn(DiscordBotClientService.prototype, 'disconnect')
        .mockResolvedValue();
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockResolvedValue(undefined);
      jest.spyOn(DiscordBotClientService.prototype, 'getGuildInfo').mockReturnValue({
        name: 'Guild',
        memberCount: 10,
      });

      await service.testToken('valid-token');

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});
