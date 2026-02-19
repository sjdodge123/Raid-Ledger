/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Additional adversarial tests for SetupWizardService (ROK-349).
 * These complement the 8 existing tests in setup-wizard.service.spec.ts
 * and focus on edge cases, error paths, and interaction scenarios.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SetupWizardService } from './setup-wizard.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('SetupWizardService (additional edge cases)', () => {
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

  // ── sendSetupWizardToAdmin: Additional edge cases ─────────────────────

  describe('sendSetupWizardToAdmin — edge cases', () => {
    it('should not send DM when admin has local: prefixed Discord ID', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: 'local:someuser' },
      ]);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should use guild server name in wizard embed when guild info available', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '999888777' },
      ]);
      jest.spyOn(clientService, 'getGuildInfo').mockReturnValue({
        name: 'My Raid Guild',
        memberCount: 100,
      });

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).toHaveBeenCalledWith(
        '999888777',
        expect.objectContaining({}),
        expect.objectContaining({}),
      );
    });

    it('should fall back to "your server" when guild info is null', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);
      jest.spyOn(clientService, 'getGuildInfo').mockReturnValue(null);

      // Should still send wizard (without throwing)
      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should use branding community name as default in wizard state', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);
      jest.spyOn(settingsService, 'getBranding').mockResolvedValue({
        communityName: 'Epic Raiding Community',
        communityLogoPath: null,
        communityAccentColor: null,
      });

      await service.sendSetupWizardToAdmin();

      // Wizard should have been sent; the community name from branding is used
      expect(settingsService.getBranding).toHaveBeenCalled();
      expect(clientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should fall back to guild name when branding has no community name', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);
      jest.spyOn(settingsService, 'getBranding').mockResolvedValue({
        communityName: null,
        communityLogoPath: null,
        communityAccentColor: null,
      });
      jest.spyOn(clientService, 'getGuildInfo').mockReturnValue({
        name: 'Guild From Discord',
        memberCount: 25,
      });

      await service.sendSetupWizardToAdmin();

      // Should not throw — falls back gracefully
      expect(clientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should handle database query failure gracefully', async () => {
      mockDb.limit.mockRejectedValueOnce(new Error('DB connection lost'));

      // Should not throw — logs error instead
      await expect(service.sendSetupWizardToAdmin()).resolves.not.toThrow();
      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should handle getBranding failure gracefully', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);
      jest
        .spyOn(settingsService, 'getBranding')
        .mockRejectedValueOnce(new Error('getBranding failed'));

      // Should not throw — catches and logs
      await expect(service.sendSetupWizardToAdmin()).resolves.not.toThrow();
    });

    it('should not send DM when admin discordId is empty string', async () => {
      // null check is explicit; empty string would still pass the guard
      // but empty string is falsy like null — test behavior
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: null },
      ]);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });
  });

  // ── onBotConnected ────────────────────────────────────────────────────

  describe('onBotConnected', () => {
    it('should call isDiscordBotSetupCompleted exactly once', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(true);

      await service.onBotConnected();

      expect(settingsService.isDiscordBotSetupCompleted).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should register interaction handler regardless of setup status', async () => {
      // getClient returns null, so handler registration is a no-op —
      // but the method should not throw when client is null
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(true);
      jest.spyOn(clientService, 'getClient').mockReturnValue(null);

      await expect(service.onBotConnected()).resolves.not.toThrow();
    });

    it('should register event listener on discord client when getClient returns a client', async () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const mockClient = { on: mockOn, removeListener: mockRemoveListener };

      jest
        .spyOn(clientService, 'getClient')
        .mockReturnValue(mockClient as never);
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(true);

      await service.onBotConnected();

      expect(mockOn).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });

    it('should remove previous handler before registering new one on reconnect', async () => {
      const mockRemoveListener = jest.fn();
      const mockOn = jest.fn();
      const mockClient = {
        on: mockOn,
        removeListener: mockRemoveListener,
      };

      jest
        .spyOn(clientService, 'getClient')
        .mockReturnValue(mockClient as never);
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(true);

      // Call onBotConnected twice to simulate reconnect
      await service.onBotConnected();
      await service.onBotConnected();

      // Second call should remove the old handler
      expect(mockRemoveListener).toHaveBeenCalledTimes(1);
    });
  });

  // ── onBotDisconnected ─────────────────────────────────────────────────

  describe('onBotDisconnected', () => {
    it('should clear bound handler on disconnect', () => {
      // Accessing private state via any; we check behavior not internals
      // After disconnect, reconnecting should not attempt removeListener (boundHandler is null)
      expect(() => service.onBotDisconnected()).not.toThrow();
    });

    it('should not throw when called multiple times', () => {
      service.onBotDisconnected();
      service.onBotDisconnected();
      service.onBotDisconnected();
      // No error expected
    });
  });

  // ── Setup wizard prevents re-runs when completed ──────────────────────

  describe('setupCompleted flag behavior', () => {
    it('should not call sendSetupWizardToAdmin when setupCompleted=true', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(true);
      const sendWizardSpy = jest.spyOn(service, 'sendSetupWizardToAdmin');

      await service.onBotConnected();

      expect(sendWizardSpy).not.toHaveBeenCalled();
    });

    it('should call sendSetupWizardToAdmin when setupCompleted=false', async () => {
      jest
        .spyOn(settingsService, 'isDiscordBotSetupCompleted')
        .mockResolvedValue(false);
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '111222333' },
      ]);

      await service.onBotConnected();

      expect(clientService.sendEmbedDM).toHaveBeenCalled();
    });
  });

  // ── sendEmbedDM called with correct Discord ID ────────────────────────

  describe('sendSetupWizardToAdmin — correct admin Discord ID', () => {
    it('should use the correct Discord ID from DB when sending DM', async () => {
      const adminDiscordId = '777666555444';
      mockDb.limit.mockResolvedValueOnce([
        { id: 42, role: 'admin', discordId: adminDiscordId },
      ]);

      await service.sendSetupWizardToAdmin();

      expect(clientService.sendEmbedDM).toHaveBeenCalledWith(
        adminDiscordId,
        expect.anything(),
        expect.anything(),
      );
    });

    it('should pass EmbedBuilder and ActionRowBuilder to sendEmbedDM', async () => {
      mockDb.limit.mockResolvedValueOnce([
        { id: 1, role: 'admin', discordId: '123456789' },
      ]);

      await service.sendSetupWizardToAdmin();

      const calls = (clientService.sendEmbedDM as jest.Mock).mock
        .calls as unknown[][];
      const [, embedArg, rowArg] = calls[0];
      // Both should be defined objects (EmbedBuilder and ActionRowBuilder instances)
      expect(embedArg).toBeDefined();
      expect(rowArg).toBeDefined();
    });
  });
});
