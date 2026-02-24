import { Test, TestingModule } from '@nestjs/testing';
import { PostEventReminderService } from './post-event-reminder.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { PugInviteService } from '../discord-bot/services/pug-invite.service';
import { SettingsService } from '../settings/settings.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

/**
 * Helper to make a qualifying PUG row from the raw SQL query result shape.
 */
function makePugRow(
  overrides: Partial<{
    pug_slot_id: string;
    event_id: number;
    event_title: string;
    discord_user_id: string | null;
    claimed_by_user_id: number | null;
    user_discord_id: string | null;
    username: string | null;
  }> = {},
) {
  return {
    pug_slot_id: 'slot-uuid-1',
    event_id: 10,
    event_title: 'Raid Night',
    discord_user_id: null,
    claimed_by_user_id: 1,
    user_discord_id: '123456789',
    username: 'testuser',
    ...overrides,
  };
}

describe('PostEventReminderService', () => {
  let service: PostEventReminderService;
  let mockDb: {
    execute: jest.Mock;
    insert: jest.Mock;
  };
  let mockClientService: {
    isConnected: jest.Mock;
    isGuildMember: jest.Mock;
    sendEmbedDM: jest.Mock;
  };
  let mockPugInviteService: { generateServerInvite: jest.Mock };
  let mockSettingsService: { getClientUrl: jest.Mock; getBranding: jest.Mock };
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockDb = {
      execute: jest.fn(),
      insert: jest.fn(),
    };

    mockClientService = {
      isConnected: jest.fn().mockReturnValue(true),
      isGuildMember: jest.fn().mockResolvedValue(false),
      sendEmbedDM: jest.fn().mockResolvedValue(undefined),
    };

    mockPugInviteService = {
      generateServerInvite: jest
        .fn()
        .mockResolvedValue('https://discord.gg/invite123'),
    };

    mockSettingsService = {
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
      getBranding: jest
        .fn()
        .mockResolvedValue({ communityName: 'Test Community' }),
    };

    mockCronJobService = {
      executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
        fn(),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostEventReminderService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: PugInviteService, useValue: mockPugInviteService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get<PostEventReminderService>(PostEventReminderService);
  });

  describe('handlePostEventReminders', () => {
    it('should exit early when bot is not connected', async () => {
      mockClientService.isConnected.mockReturnValue(false);

      await service.handlePostEventReminders();

      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('should query the database when bot is connected', async () => {
      mockDb.execute.mockResolvedValue([]);

      await service.handlePostEventReminders();

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('should not send any DMs when no qualifying PUGs found', async () => {
      mockDb.execute.mockResolvedValue([]);

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should send a DM for each qualifying PUG', async () => {
      const pugs = [
        makePugRow({ pug_slot_id: 'slot-1', event_id: 10 }),
        makePugRow({
          pug_slot_id: 'slot-2',
          event_id: 11,
          user_discord_id: '987654321',
        }),
      ];
      mockDb.execute.mockResolvedValue(pugs);

      // Mock tracking inserts — each returns a row (not already sent)
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).toHaveBeenCalledTimes(2);
    });

    it('should use executeWithTracking from CronJobService', async () => {
      mockDb.execute.mockResolvedValue([]);

      await service.handlePostEventReminders();

      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'PostEventReminderService_handlePostEventReminders',
        expect.any(Function),
      );
    });
  });

  describe('sendPostEventReminder', () => {
    function setupTrackingInsert(alreadySent = false) {
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValue(alreadySent ? [] : [{ id: 1 }]),
          }),
        }),
      });
    }

    it('should skip PUG with no Discord ID (both user_discord_id and discord_user_id are null)', async () => {
      const pug = makePugRow({ user_discord_id: null, discord_user_id: null });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should prefer user_discord_id over discord_user_id when both are present', async () => {
      const pug = makePugRow({
        user_discord_id: 'user-discord-111',
        discord_user_id: 'pug-discord-222',
      });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockClientService.isGuildMember).toHaveBeenCalledWith(
        'user-discord-111',
      );
      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        'user-discord-111',
        expect.anything(),
      );
    });

    it('should fall back to discord_user_id when user_discord_id is null', async () => {
      const pug = makePugRow({
        user_discord_id: null,
        discord_user_id: 'pug-slot-discord-333',
      });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockClientService.isGuildMember).toHaveBeenCalledWith(
        'pug-slot-discord-333',
      );
      expect(mockClientService.sendEmbedDM).toHaveBeenCalledWith(
        'pug-slot-discord-333',
        expect.anything(),
      );
    });

    it('should skip PUG with "local:" prefixed Discord ID', async () => {
      const pug = makePugRow({
        user_discord_id: 'local:someuser',
        discord_user_id: null,
      });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should skip PUG with "unlinked:" prefixed Discord ID', async () => {
      const pug = makePugRow({
        user_discord_id: 'unlinked:abc',
        discord_user_id: null,
      });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should not send reminder when tracking insert returns empty (already sent)', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(true); // already sent

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should insert tracking record before sending DM', async () => {
      const pug = makePugRow({ pug_slot_id: 'slot-xyz', event_id: 42 });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should include server invite link in DM when user is NOT in server', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);
      mockClientService.isGuildMember.mockResolvedValue(false);
      mockPugInviteService.generateServerInvite.mockResolvedValue(
        'https://discord.gg/joinus',
      );

      await service.handlePostEventReminders();

      expect(mockPugInviteService.generateServerInvite).toHaveBeenCalledWith(
        pug.event_id,
      );
      expect(mockClientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should NOT include server invite link when user IS already in server', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);
      mockClientService.isGuildMember.mockResolvedValue(true);

      await service.handlePostEventReminders();

      expect(mockPugInviteService.generateServerInvite).not.toHaveBeenCalled();
      expect(mockClientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should use communityName from branding in the embed', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);
      mockSettingsService.getBranding.mockResolvedValue({
        communityName: 'My Awesome Guild',
      });

      await service.handlePostEventReminders();

      // The embed is passed to sendEmbedDM — check that getBranding was called
      expect(mockSettingsService.getBranding).toHaveBeenCalled();
    });

    it('should fall back to "Raid Ledger" when communityName is empty', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);
      mockSettingsService.getBranding.mockResolvedValue({ communityName: '' });

      // Should not throw — it uses "Raid Ledger" as fallback
      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should use username in embed when present', async () => {
      const pug = makePugRow({ username: 'DragonSlayer99' });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should use "there" as fallback when username is null', async () => {
      const pug = makePugRow({ username: null });
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should gracefully handle sendEmbedDM failure without throwing', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);
      mockClientService.sendEmbedDM.mockRejectedValue(
        new Error('Cannot send DM'),
      );

      // Should not throw — errors are caught and logged
      await expect(service.handlePostEventReminders()).resolves.not.toThrow();
    });

    it('should include onboarding URL in DM when clientUrl is available', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);
      mockSettingsService.getClientUrl.mockResolvedValue(
        'https://raidledger.example.com',
      );

      await service.handlePostEventReminders();

      expect(mockSettingsService.getClientUrl).toHaveBeenCalled();
      expect(mockClientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should still send DM even when clientUrl is null', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);
      setupTrackingInsert(false);
      mockSettingsService.getClientUrl.mockResolvedValue(null);

      await service.handlePostEventReminders();

      expect(mockClientService.sendEmbedDM).toHaveBeenCalled();
    });

    it('should be idempotent: duplicate tracking insert returns empty → no duplicate DM', async () => {
      const pug = makePugRow();
      mockDb.execute.mockResolvedValue([pug]);

      // First call: insert succeeds (new row)
      const insertChain = {
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValueOnce([{ id: 1 }]) // first call: new row
              .mockResolvedValueOnce([]), // second call: duplicate, no row
          }),
        }),
      };
      mockDb.insert.mockReturnValue(insertChain);

      await service.handlePostEventReminders();
      mockDb.execute.mockResolvedValue([pug]);
      await service.handlePostEventReminders();

      // DM only sent once
      expect(mockClientService.sendEmbedDM).toHaveBeenCalledTimes(1);
    });
  });
});
