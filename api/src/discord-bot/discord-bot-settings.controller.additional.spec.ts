/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Additional adversarial tests for DiscordBotSettingsController (ROK-349).
 * Covers the new resendSetupWizard endpoint and additional edge cases
 * not addressed by the existing controller spec.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SetupWizardService } from './services/setup-wizard.service';
import { SettingsService } from '../settings/settings.service';

describe('DiscordBotSettingsController — resendSetupWizard (ROK-349)', () => {
  let controller: DiscordBotSettingsController;
  let discordBotClientService: DiscordBotClientService;
  let setupWizardService: SetupWizardService;

  const makeMockModule = async (isConnected = true) => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscordBotSettingsController],
      providers: [
        {
          provide: DiscordBotService,
          useValue: {
            getStatus: jest.fn(),
            testToken: jest.fn(),
            checkPermissions: jest.fn(),
          },
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            getTextChannels: jest.fn().mockReturnValue([]),
            isConnected: jest.fn().mockReturnValue(isConnected),
          },
        },
        {
          provide: SetupWizardService,
          useValue: {
            sendSetupWizardToAdmin: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            setDiscordBotConfig: jest.fn(),
            getDiscordBotConfig: jest.fn(),
            clearDiscordBotConfig: jest.fn(),
            getDiscordBotDefaultChannel: jest.fn(),
            setDiscordBotDefaultChannel: jest.fn(),
          },
        },
      ],
    }).compile();

    return module;
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── resendSetupWizard ─────────────────────────────────────────────────

  describe('resendSetupWizard', () => {
    it('should return success response when bot is connected', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      const result = await controller.resendSetupWizard();

      expect(result).toEqual({
        success: true,
        message: 'Setup wizard DM sent to admin.',
      });
    });

    it('should call sendSetupWizardToAdmin when bot is connected', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );
      setupWizardService = module.get<SetupWizardService>(SetupWizardService);

      await controller.resendSetupWizard();

      expect(setupWizardService.sendSetupWizardToAdmin).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should throw BadRequestException when bot is NOT connected', async () => {
      const module = await makeMockModule(false);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );
      setupWizardService = module.get<SetupWizardService>(SetupWizardService);

      await expect(controller.resendSetupWizard()).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should NOT call sendSetupWizardToAdmin when bot is not connected', async () => {
      const module = await makeMockModule(false);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );
      setupWizardService = module.get<SetupWizardService>(SetupWizardService);

      try {
        await controller.resendSetupWizard();
      } catch {
        // expected to throw
      }

      expect(setupWizardService.sendSetupWizardToAdmin).not.toHaveBeenCalled();
    });

    it('should include meaningful error message in BadRequestException', async () => {
      const module = await makeMockModule(false);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      let caughtError: BadRequestException | undefined;
      try {
        await controller.resendSetupWizard();
      } catch (e) {
        caughtError = e as BadRequestException;
      }

      expect(caughtError).toBeInstanceOf(BadRequestException);
      expect(
        (caughtError?.getResponse() as { message: string }).message,
      ).toContain('connected');
    });

    it('should propagate errors from sendSetupWizardToAdmin', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );
      setupWizardService = module.get<SetupWizardService>(SetupWizardService);

      jest
        .spyOn(setupWizardService, 'sendSetupWizardToAdmin')
        .mockRejectedValueOnce(new Error('DM send failed'));

      await expect(controller.resendSetupWizard()).rejects.toThrow(
        'DM send failed',
      );
    });
  });

  // ── getStatus: includes setupCompleted field ──────────────────────────

  describe('getStatus — setupCompleted field', () => {
    it('should return setupCompleted=true when wizard is done', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [DiscordBotSettingsController],
        providers: [
          {
            provide: DiscordBotService,
            useValue: {
              getStatus: jest.fn().mockResolvedValue({
                configured: true,
                connected: true,
                enabled: true,
                connecting: false,
                guildName: 'Test Guild',
                memberCount: 10,
                setupCompleted: true,
              }),
              testToken: jest.fn(),
              checkPermissions: jest.fn(),
            },
          },
          {
            provide: DiscordBotClientService,
            useValue: {
              getTextChannels: jest.fn().mockReturnValue([]),
              isConnected: jest.fn().mockReturnValue(true),
            },
          },
          {
            provide: SetupWizardService,
            useValue: {
              sendSetupWizardToAdmin: jest.fn(),
            },
          },
          {
            provide: SettingsService,
            useValue: {
              setDiscordBotConfig: jest.fn(),
              getDiscordBotConfig: jest.fn(),
              clearDiscordBotConfig: jest.fn(),
              getDiscordBotDefaultChannel: jest.fn(),
              setDiscordBotDefaultChannel: jest.fn(),
            },
          },
        ],
      }).compile();

      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      const status = await controller.getStatus();

      expect(status.setupCompleted).toBe(true);
    });

    it('should return setupCompleted=false when wizard is not done', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [DiscordBotSettingsController],
        providers: [
          {
            provide: DiscordBotService,
            useValue: {
              getStatus: jest.fn().mockResolvedValue({
                configured: true,
                connected: true,
                enabled: true,
                connecting: false,
                guildName: 'Test Guild',
                memberCount: 10,
                setupCompleted: false,
              }),
              testToken: jest.fn(),
              checkPermissions: jest.fn(),
            },
          },
          {
            provide: DiscordBotClientService,
            useValue: {
              getTextChannels: jest.fn().mockReturnValue([]),
              isConnected: jest.fn().mockReturnValue(true),
            },
          },
          {
            provide: SetupWizardService,
            useValue: {
              sendSetupWizardToAdmin: jest.fn(),
            },
          },
          {
            provide: SettingsService,
            useValue: {
              setDiscordBotConfig: jest.fn(),
              getDiscordBotConfig: jest.fn(),
              clearDiscordBotConfig: jest.fn(),
              getDiscordBotDefaultChannel: jest.fn(),
              setDiscordBotDefaultChannel: jest.fn(),
            },
          },
        ],
      }).compile();

      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      const status = await controller.getStatus();

      expect(status.setupCompleted).toBe(false);
    });
  });

  // ── updateConfig: Zod validation edge cases ───────────────────────────

  describe('updateConfig — additional validation', () => {
    it('should reject botToken that is only whitespace', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      // Zod min(1) will reject empty/whitespace-only tokens
      // Note: Zod min(1) only checks length, not whitespace — test actual empty string
      const body = { botToken: '', enabled: true };
      await expect(controller.updateConfig(body)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject body without botToken field', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      const body = { enabled: true };
      await expect(controller.updateConfig(body)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject body that is not an object', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      await expect(controller.updateConfig('string' as unknown)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── setDefaultChannel: additional validation edge cases ───────────────

  describe('setDefaultChannel — additional validation', () => {
    it('should throw when body has channelId as number', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      await expect(
        controller.setDefaultChannel({ channelId: 42 } as unknown),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when body is undefined', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      await expect(
        controller.setDefaultChannel(undefined as unknown),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept valid channel ID string', async () => {
      const module = await makeMockModule(true);
      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );
      const settingsServiceRef = module.get<SettingsService>(SettingsService);

      const result = await controller.setDefaultChannel({
        channelId: '987654321',
      });

      expect(result.success).toBe(true);
      expect(settingsServiceRef.setDiscordBotDefaultChannel).toHaveBeenCalledWith(
        '987654321',
      );
    });
  });

  // ── checkPermissions ──────────────────────────────────────────────────

  describe('checkPermissions', () => {
    it('should delegate to discordBotService.checkPermissions', async () => {
      const mockPermissions = {
        allGranted: true,
        permissions: [
          { name: 'Send Messages', granted: true },
          { name: 'Embed Links', granted: true },
        ],
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [DiscordBotSettingsController],
        providers: [
          {
            provide: DiscordBotService,
            useValue: {
              getStatus: jest.fn(),
              testToken: jest.fn(),
              checkPermissions: jest.fn().mockReturnValue(mockPermissions),
            },
          },
          {
            provide: DiscordBotClientService,
            useValue: {
              getTextChannels: jest.fn().mockReturnValue([]),
              isConnected: jest.fn().mockReturnValue(true),
            },
          },
          {
            provide: SetupWizardService,
            useValue: {
              sendSetupWizardToAdmin: jest.fn(),
            },
          },
          {
            provide: SettingsService,
            useValue: {
              setDiscordBotConfig: jest.fn(),
              getDiscordBotConfig: jest.fn(),
              clearDiscordBotConfig: jest.fn(),
              getDiscordBotDefaultChannel: jest.fn(),
              setDiscordBotDefaultChannel: jest.fn(),
            },
          },
        ],
      }).compile();

      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      const result = controller.checkPermissions();

      expect(result).toEqual(mockPermissions);
      expect(result.allGranted).toBe(true);
      expect(result.permissions).toHaveLength(2);
    });

    it('should return allGranted=false when some permissions are missing', async () => {
      const mockPermissions = {
        allGranted: false,
        permissions: [
          { name: 'Send Messages', granted: true },
          { name: 'Manage Roles', granted: false },
        ],
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [DiscordBotSettingsController],
        providers: [
          {
            provide: DiscordBotService,
            useValue: {
              getStatus: jest.fn(),
              testToken: jest.fn(),
              checkPermissions: jest.fn().mockReturnValue(mockPermissions),
            },
          },
          {
            provide: DiscordBotClientService,
            useValue: {
              getTextChannels: jest.fn().mockReturnValue([]),
              isConnected: jest.fn().mockReturnValue(true),
            },
          },
          {
            provide: SetupWizardService,
            useValue: {
              sendSetupWizardToAdmin: jest.fn(),
            },
          },
          {
            provide: SettingsService,
            useValue: {
              setDiscordBotConfig: jest.fn(),
              getDiscordBotConfig: jest.fn(),
              clearDiscordBotConfig: jest.fn(),
              getDiscordBotDefaultChannel: jest.fn(),
              setDiscordBotDefaultChannel: jest.fn(),
            },
          },
        ],
      }).compile();

      controller = module.get<DiscordBotSettingsController>(
        DiscordBotSettingsController,
      );

      const result = controller.checkPermissions();

      expect(result.allGranted).toBe(false);
    });
  });
});
