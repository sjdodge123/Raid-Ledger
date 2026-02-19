/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SetupWizardService } from './setup-wizard.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('SetupWizardService', () => {
  let service: SetupWizardService;
  let clientService: DiscordBotClientService;
  let settingsService: SettingsService;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupWizardService,
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getClient: jest.fn().mockReturnValue(null),
            getGuildInfo: jest
              .fn()
              .mockReturnValue({ name: 'Test Guild', memberCount: 50 }),
            getTextChannels: jest.fn().mockReturnValue([
              { id: '111', name: 'general' },
              { id: '222', name: 'raids' },
            ]),
            sendEmbedDM: jest.fn().mockResolvedValue(undefined),
            sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            isDiscordBotSetupCompleted: jest.fn().mockResolvedValue(false),
            markDiscordBotSetupCompleted: jest
              .fn()
              .mockResolvedValue(undefined),
            setDiscordBotDefaultChannel: jest.fn().mockResolvedValue(undefined),
            setDiscordBotCommunityName: jest.fn().mockResolvedValue(undefined),
            setDiscordBotTimezone: jest.fn().mockResolvedValue(undefined),
            getBranding: jest.fn().mockResolvedValue({
              communityName: 'Test Community',
              communityLogoPath: null,
              communityAccentColor: null,
            }),
            setCommunityName: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            on: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SetupWizardService>(SetupWizardService);
    clientService = module.get<DiscordBotClientService>(
      DiscordBotClientService,
    );
    settingsService = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendSetupWizardToAdmin', () => {
    it('should send wizard DM when admin has Discord ID', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).toHaveBeenCalledWith(
        '123456789',
        expect.objectContaining({}),
        expect.objectContaining({}),
      );
    });

    it('should not send wizard DM when bot is not connected', async () => {
      jest.spyOn(clientService, 'isConnected').mockReturnValue(false);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should not send wizard DM when no admin found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should not send wizard DM when admin has no Discord ID', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: null },
      ]);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should not send wizard DM when admin has unlinked Discord ID', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: 'unlinked:123456789' },
      ]);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should handle DM send failure gracefully', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);
      jest
        .spyOn(clientService, 'sendEmbedDM')
        .mockRejectedValueOnce(new Error('Cannot send DM'));

      // Should not throw
      await service.sendSetupWizardToAdmin();
    });
  });

  describe('onBotConnected', () => {
    it('should send wizard when setup is not completed', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(false);
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);

      await service.onBotConnected();

      expect(settingsService.isDiscordBotSetupCompleted).toHaveBeenCalled();
      expect(clientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should not send wizard when setup is already completed', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(true);

      await service.onBotConnected();

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });
  });
});
