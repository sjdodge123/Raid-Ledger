/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';

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
            isConnecting: jest.fn(),
            getGuildInfo: jest.fn(),
            sendDirectMessage: jest.fn(),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getDiscordBotConfig: jest.fn(),
            isDiscordBotConfigured: jest.fn(),
            isDiscordBotSetupCompleted: jest.fn().mockResolvedValue(false),
            getAdHocEventsEnabled: jest.fn().mockResolvedValue(false),
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

  describe('onApplicationBootstrap', () => {
    it('should auto-connect when configured and enabled', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(mockDiscordBotConfig);

      await service.onApplicationBootstrap();

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(clientService.connect).toHaveBeenCalledWith(
        mockDiscordBotConfig.token,
      );
    });

    it('should not connect when config is null', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(null);

      await service.onApplicationBootstrap();

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should not connect when enabled is false', async () => {
      jest.spyOn(settingsService, 'getDiscordBotConfig').mockResolvedValue({
        token: 'test-token',
        enabled: false,
      });

      await service.onApplicationBootstrap();

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
      await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

      expect(clientService.connect).toHaveBeenCalled();
    });

    it('should handle settings service errors without crashing', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(service.onApplicationBootstrap()).resolves.not.toThrow();

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

  describe('ensureConnected', () => {
    it('should connect when not connected and not connecting', async () => {
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);

      await service.ensureConnected(mockDiscordBotConfig);

      expect(clientService.connect).toHaveBeenCalledWith(
        mockDiscordBotConfig.token,
      );
    });

    it('should skip when already connected', async () => {
      jest.spyOn(clientService, 'isConnected').mockReturnValue(true);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);

      await service.ensureConnected(mockDiscordBotConfig);

      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should skip when already connecting', async () => {
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(true);

      await service.ensureConnected(mockDiscordBotConfig);

      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should skip when not enabled', async () => {
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);

      await service.ensureConnected({ token: 'test-token', enabled: false });

      expect(clientService.connect).not.toHaveBeenCalled();
    });

    it('should handle connection errors without crashing', async () => {
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);
      jest
        .spyOn(clientService, 'connect')
        .mockRejectedValue(new Error('Connection failed'));

      await expect(
        service.ensureConnected(mockDiscordBotConfig),
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
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue({ token: 'tok', enabled: true });
      jest.spyOn(clientService, 'isConnected').mockReturnValue(true);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);
      jest.spyOn(clientService, 'getGuildInfo').mockReturnValue({
        name: 'Test Guild',
        memberCount: 100,
      });

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: true,
        enabled: true,
        connecting: false,
        guildName: 'Test Guild',
        memberCount: 100,
        setupCompleted: false,
        adHocEventsEnabled: false,
      });
    });

    it('should return status when configured but not connected', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue({ token: 'tok', enabled: true });
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: false,
        enabled: true,
        connecting: false,
        guildName: undefined,
        memberCount: undefined,
        setupCompleted: false,
        adHocEventsEnabled: false,
      });
    });

    it('should return status when not configured', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(null);
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: false,
        connected: false,
        enabled: undefined,
        connecting: false,
        guildName: undefined,
        memberCount: undefined,
        setupCompleted: false,
        adHocEventsEnabled: false,
      });
    });

    it('should handle null guild info', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue({ token: 'tok', enabled: true });
      jest.spyOn(clientService, 'isConnected').mockReturnValue(true);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);
      jest.spyOn(clientService, 'getGuildInfo').mockReturnValue(null);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: true,
        enabled: true,
        connecting: false,
        guildName: undefined,
        memberCount: undefined,
        setupCompleted: false,
        adHocEventsEnabled: false,
      });
    });

    it('should return connecting=true when bot is connecting', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue({ token: 'tok', enabled: true });
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(true);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: false,
        enabled: true,
        connecting: true,
        guildName: undefined,
        memberCount: undefined,
        setupCompleted: false,
        adHocEventsEnabled: false,
      });
    });

    it('should return enabled=false when bot is disabled', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue({ token: 'tok', enabled: false });
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);
      jest.spyOn(clientService, 'isConnecting').mockReturnValue(false);

      const status = await service.getStatus();

      expect(status).toEqual({
        configured: true,
        connected: false,
        enabled: false,
        connecting: false,
        guildName: undefined,
        memberCount: undefined,
        setupCompleted: false,
        adHocEventsEnabled: false,
      });
    });
  });

  describe('testToken', () => {
    it('should return success when token is valid and bot is in guilds', async () => {
      // We need to mock the DiscordBotClientService constructor
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockResolvedValue(undefined);
      jest
        .spyOn(DiscordBotClientService.prototype, 'disconnect')
        .mockResolvedValue();
      jest
        .spyOn(DiscordBotClientService.prototype, 'getGuildInfo')
        .mockReturnValue({
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
      jest
        .spyOn(DiscordBotClientService.prototype, 'disconnect')
        .mockResolvedValue();
      jest
        .spyOn(DiscordBotClientService.prototype, 'getGuildInfo')
        .mockReturnValue(null);

      const result = await service.testToken('valid-token-no-guilds');

      expect(result).toEqual({
        success: true,
        guildName: undefined,
        message:
          'Bot token is valid! Almost done — invite the bot to your Discord server using the OAuth2 URL Generator in the Developer Portal.',
      });
    });

    it('should return friendly message for invalid token', async () => {
      const error = new Error('TOKEN_INVALID: the token is wrong');
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockRejectedValue(error);

      const result = await service.testToken('invalid-token');

      expect(result).toEqual({
        success: false,
        message: 'Invalid bot token. Please check the token and try again.',
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

    it('should return friendly message for ECONNREFUSED', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockRejectedValue(error);

      const result = await service.testToken('refused-token');

      expect(result).toEqual({
        success: false,
        message:
          'Connection to Discord was refused. Try again in a few moments.',
      });
    });

    it('should return generic message for unknown errors', async () => {
      const error = new Error('Something totally unexpected');
      jest
        .spyOn(DiscordBotClientService.prototype, 'connect')
        .mockRejectedValue(error);

      const result = await service.testToken('unknown-error-token');

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
      jest
        .spyOn(DiscordBotClientService.prototype, 'getGuildInfo')
        .mockReturnValue({
          name: 'Guild',
          memberCount: 10,
        });

      await service.testToken('valid-token');

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });
});
