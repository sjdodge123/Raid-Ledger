import { RecruitmentReminderService } from './recruitment-reminder.service';
import {
  makeEventRow,
  createRecruitmentReminderTestModule,
  type RecruitmentReminderTestMocks,
} from './recruitment-reminder.service.spec-helpers';
import { DEFAULT_CLIENT_URL } from '../settings/settings-bot.helpers';

// Mock discord.js — uses shared mock (includes Client + PermissionsBitField)
jest.mock(
  'discord.js',
  () =>
    jest.requireActual('../common/testing/discord-js-mock').discordJsFullMock,
);

describe('RecruitmentReminderService', () => {
  let service: RecruitmentReminderService;
  let mocks: RecruitmentReminderTestMocks;

  beforeEach(async () => {
    ({ service, mocks } = await createRecruitmentReminderTestModule());
  });

  describe('handleCron', () => {
    it('should delegate to CronJobService.executeWithTracking', async () => {
      mocks.mockDb.execute.mockResolvedValue([]);

      await service.handleCron();

      expect(mocks.mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'RecruitmentReminderService_checkAndSendReminders',
        expect.any(Function),
      );
    });
  });

  describe('checkAndSendReminders — no eligible events', () => {
    it('should do nothing when no eligible events are found', async () => {
      mocks.mockDb.execute.mockResolvedValue([]);

      await service.checkAndSendReminders();

      expect(mocks.mockDedupService.checkAndMarkSent).not.toHaveBeenCalled();
      expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
      expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });
  });

  describe('checkAndSendReminders — deduplication', () => {
    it('should skip event when both dedup keys already exist', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute.mockResolvedValueOnce([event]);
      mocks.mockDedupService.checkAndMarkSent.mockResolvedValue(true); // both bump and dm already sent

      await service.checkAndSendReminders();

      expect(mocks.mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'recruitment-bump:event:42',
        48 * 60 * 60,
      );
      expect(mocks.mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'recruitment-dm:event:42',
        48 * 60 * 60,
      );
      expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should call checkAndMarkSent for DM dedup key with 48h TTL', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 10 }, { id: 11 }]) // findRecipients
        .mockResolvedValueOnce([]); // findAbsentUsers

      await service.checkAndSendReminders();

      expect(mocks.mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'recruitment-dm:event:42',
        48 * 60 * 60,
      );
    });

    it('should process multiple events independently', async () => {
      const event1 = makeEventRow({ id: 10, title: 'Event 1' });
      const event2 = makeEventRow({ id: 20, title: 'Event 2' });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event1, event2]) // findEligibleEvents
        .mockResolvedValueOnce([]) // findRecipients for event1
        .mockResolvedValueOnce([]) // findRecipients for event2
        .mockResolvedValueOnce([]); // findAbsentUsers — may not be called when no recipients

      await service.checkAndSendReminders();

      expect(mocks.mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'recruitment-bump:event:10',
        48 * 60 * 60,
      );
      expect(mocks.mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        'recruitment-bump:event:20',
        48 * 60 * 60,
      );
    });
  });

  describe('checkAndSendReminders — recipients', () => {
    it('should send DMs to all recipients when none are absent', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }, { id: 7 }]) // findRecipients
        .mockResolvedValueOnce([]); // findAbsentUsers → no absent users

      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledTimes(3);
    });

    it('should exclude absent users from DM list', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }, { id: 7 }]) // findRecipients
        .mockResolvedValueOnce([{ user_id: 6 }]); // findAbsentUsers → user 6 is absent

      await service.checkAndSendReminders();

      // Only 2 DMs: users 5 and 7 (not 6)
      expect(mocks.mockNotificationService.create).toHaveBeenCalledTimes(2);
      const calls = mocks.mockNotificationService.create.mock.calls.map(
        (c: Array<{ userId: number }>) => c[0].userId,
      );
      expect(calls).toContain(5);
      expect(calls).toContain(7);
      expect(calls).not.toContain(6);
    });

    it('should exclude ALL users when all are absent', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }]) // findRecipients
        .mockResolvedValueOnce([{ user_id: 5 }, { user_id: 6 }]); // both absent

      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should skip absent user check when recipient list is empty', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([]); // findRecipients → empty

      await service.checkAndSendReminders();

      // findAbsentUsers should not fire a DB query when there are no recipients
      // db.execute called: findEligibleEvents + findRecipients only = 2 times
      expect(mocks.mockDb.execute).toHaveBeenCalledTimes(2);
      expect(mocks.mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should still post channel bump even when there are no recipients', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event]) // findEligibleEvents
        .mockResolvedValueOnce([]); // findRecipients → empty

      await service.checkAndSendReminders();

      // Channel bump should still fire
      expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAndSendReminders — DM notification payload', () => {
    beforeEach(() => {
      // Default: one event, two recipients, no absences
      const event = makeEventRow({
        id: 42,
        title: 'Mythic Raid Night',
        game_id: 7,
        game_name: 'World of Warcraft',
        creator_id: 1,
        start_time: '2026-03-04T20:00:00.000Z',
        max_attendees: 20,
        signup_count: '10',
        channel_id: 'channel-abc',
        guild_id: 'guild-xyz',
        message_id: 'msg-123',
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);
    });

    it('should create notification with type recruitment_reminder', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'recruitment_reminder' }),
      );
    });

    it('should include eventId in notification payload', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ eventId: 42 }),
        }),
      );
    });

    it('should include gameName in notification payload', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ gameName: 'World of Warcraft' }),
        }),
      );
    });

    it('should include signupSummary with max_attendees when set', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            signupSummary: '10/20 spots filled',
          }),
        }),
      );
    });

    it('should include event URL in payload', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            url: 'http://localhost:5173/events/42',
          }),
        }),
      );
    });

    it('should include discordUrl in payload', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            discordUrl:
              'https://discord.com/channels/guild-xyz/channel-abc/msg-123',
          }),
        }),
      );
    });

    it('should include startTime in payload', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            startTime: '2026-03-04T20:00:00.000Z',
          }),
        }),
      );
    });

    it('should include voiceChannelId in payload when resolveVoiceChannelForEvent returns a value', async () => {
      mocks.mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
        'vc-999',
      );

      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ voiceChannelId: 'vc-999' }),
        }),
      );
    });

    it('should NOT include voiceChannelId in payload when resolveVoiceChannelForEvent returns null', async () => {
      mocks.mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
        null,
      );

      await service.checkAndSendReminders();

      const call = mocks.mockNotificationService.create.mock.calls[0][0];
      expect(call.payload).not.toHaveProperty('voiceChannelId');
    });

    it('should set title to "Spots Available — {eventTitle}"', async () => {
      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Spots Available — Mythic Raid Night',
        }),
      );
    });
  });

  describe('checkAndSendReminders — signupSummary formatting', () => {
    it('should format signupSummary as "X signed up" when max_attendees is null', async () => {
      const event = makeEventRow({ max_attendees: null, signup_count: '5' });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ signupSummary: '5 signed up' }),
        }),
      );
    });

    it('should format signupSummary as "X/Y spots filled" when max_attendees is set', async () => {
      const event = makeEventRow({ max_attendees: 30, signup_count: '15' });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            signupSummary: '15/30 spots filled',
          }),
        }),
      );
    });
  });

  describe('checkAndSendReminders — error handling in sendRecruitmentDMs', () => {
    it('should continue processing remaining recipients when one DM fails', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }, { id: 6 }])
        .mockResolvedValueOnce([]);

      // First notification fails, second succeeds
      mocks.mockNotificationService.create
        .mockRejectedValueOnce(new Error('DM failed for user 5'))
        .mockResolvedValueOnce({ id: 'notif-uuid-2' });

      // Should not throw
      await expect(service.checkAndSendReminders()).resolves.not.toThrow();

      // Both were attempted
      expect(mocks.mockNotificationService.create).toHaveBeenCalledTimes(2);
    });

    it('should still post channel bump when DM sending fails', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      mocks.mockNotificationService.create.mockRejectedValue(
        new Error('DM failed'),
      );

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkAndSendReminders — channel bump', () => {
    it('should post channel bump embed when bot is connected', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mocks.mockDiscordBotClient.isConnected.mockReturnValue(true);

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
      expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledWith(
        'channel-abc',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should skip channel bump when bot is not connected', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      mocks.mockDiscordBotClient.isConnected.mockReturnValue(false);

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('should not throw when channel bump sendEmbed fails', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      mocks.mockDiscordBotClient.sendEmbed.mockRejectedValue(
        new Error('Channel not found'),
      );

      await expect(service.checkAndSendReminders()).resolves.not.toThrow();
    });

    it('should use clientUrl from settings in the bump Sign Up button URL', async () => {
      const event = makeEventRow({ id: 99 });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      mocks.mockSettingsService.getClientUrl.mockResolvedValue(
        'https://raidledger.example.com',
      );

      await service.checkAndSendReminders();

      // sendEmbed is called with (channelId, embed, row)
      const [, , row] = mocks.mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        unknown,
        { toJSON: () => { components: Array<{ url: string; label: string }> } },
      ];
      const rowJson = row.toJSON();
      const signUpBtn = rowJson.components.find(
        (c: { label: string }) => c.label === 'View Event',
      );
      expect(signUpBtn).toBeDefined();
      expect(signUpBtn?.url).toContain(
        'https://raidledger.example.com/events/99',
      );
    });

    it('should use default client URL when settings returns the fallback', async () => {
      const event = makeEventRow({ id: 55 });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      mocks.mockSettingsService.getClientUrl.mockResolvedValue(
        DEFAULT_CLIENT_URL,
      );

      await service.checkAndSendReminders();

      const [, , row] = mocks.mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        unknown,
        { toJSON: () => { components: Array<{ url: string; label: string }> } },
      ];
      const rowJson = row.toJSON();
      const signUpBtn = rowJson.components.find(
        (c: { label: string }) => c.label === 'View Event',
      );
      expect(signUpBtn?.url).toContain(`${DEFAULT_CLIENT_URL}/events/55`);
    });

    it('should skip channel bump when event is full (signupCount >= maxAttendees)', async () => {
      const event = makeEventRow({
        max_attendees: 10,
        signup_count: '10',
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('should skip channel bump when event is over-full (signupCount > maxAttendees)', async () => {
      const event = makeEventRow({
        max_attendees: 10,
        signup_count: '12',
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('should post channel bump when max_attendees is null (no cap)', async () => {
      const event = makeEventRow({
        max_attendees: null,
        signup_count: '50',
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockDiscordBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('should use "tomorrow" in embed title when event is <= 24h away', async () => {
      const event = makeEventRow({
        start_time: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      const [, embed] = mocks.mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        { toJSON: () => { title: string } },
      ];
      expect(embed.toJSON().title).toContain('tomorrow');
    });

    it('should use "in Xh" in embed title when event is > 24h away', async () => {
      const event = makeEventRow({
        start_time: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      const [, embed] = mocks.mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        { toJSON: () => { title: string } },
      ];
      expect(embed.toJSON().title).toMatch(/in \d+h/);
      expect(embed.toJSON().title).not.toContain('tomorrow');
    });

    it('should embed description contain event title, gameName, and signupSummary', async () => {
      const event = makeEventRow({
        id: 42,
        title: 'Mythic Raid Night',
        game_name: 'World of Warcraft',
        max_attendees: 20,
        signup_count: '10',
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      const [, embed] = mocks.mockDiscordBotClient.sendEmbed.mock.calls[0] as [
        string,
        { toJSON: () => { description: string; title: string } },
      ];
      const embedJson = embed.toJSON();
      expect(embedJson.description).toContain('Mythic Raid Night');
      expect(embedJson.description).toContain('World of Warcraft');
      expect(embedJson.description).toContain('10/20 spots filled');
    });
  });

  describe('checkAndSendReminders — settings fallbacks', () => {
    it('should fall back to UTC when getDefaultTimezone returns null', async () => {
      mocks.mockSettingsService.getDefaultTimezone.mockResolvedValue(null);

      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([{ id: 5 }])
        .mockResolvedValueOnce([]);

      // Should not throw — UTC fallback is used
      await expect(service.checkAndSendReminders()).resolves.not.toThrow();
      expect(mocks.mockNotificationService.create).toHaveBeenCalled();
    });
  });

  describe('checkAndSendReminders — bump message ID persistence (ROK-728)', () => {
    it('should persist bump message ID after posting channel bump', async () => {
      const event = makeEventRow({ id: 42 });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);
      mocks.mockDiscordBotClient.sendEmbed.mockResolvedValue({
        id: 'bump-msg-999',
      });

      await service.checkAndSendReminders();

      expect(mocks.mockDb.update).toHaveBeenCalled();
      expect(mocks.mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ bumpMessageId: 'bump-msg-999' }),
      );
    });

    it('should not persist bump message ID when bot is disconnected', async () => {
      const event = makeEventRow();
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);
      mocks.mockDiscordBotClient.isConnected.mockReturnValue(false);

      await service.checkAndSendReminders();

      expect(mocks.mockDb.update).not.toHaveBeenCalled();
    });

    it('should not persist bump message ID when event is full', async () => {
      const event = makeEventRow({
        max_attendees: 10,
        signup_count: '10',
      });
      mocks.mockDb.execute
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce([]);

      await service.checkAndSendReminders();

      expect(mocks.mockDb.update).not.toHaveBeenCalled();
    });
  });
});
