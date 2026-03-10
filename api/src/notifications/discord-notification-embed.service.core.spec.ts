import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { SettingsService } from '../settings/settings.service';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

// Mock discord.js — uses shared mock from common/testing
jest.mock(
  'discord.js',
  () => jest.requireActual('../common/testing/discord-js-mock').discordJsMock,
);

describe('DiscordNotificationEmbedService — core', () => {
  let service: DiscordNotificationEmbedService;
  let mockSettingsService: { getClientUrl: jest.Mock };

  beforeEach(() => {
    delete process.env.CLIENT_URL;
    mockSettingsService = {
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    };
    service = new DiscordNotificationEmbedService(
      mockSettingsService as unknown as SettingsService,
    );
  });

  describe('buildNotificationEmbed', () => {
    it('should return an embed and row', async () => {
      const { embed, row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Your event is soon',
        },
        'Test Community',
      );

      expect(embed).toBeDefined();
      expect(row).toBeDefined();
    });

    it('should use REMINDER color for event_reminder type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Your event is soon',
        },
        'Test Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.REMINDER);
    });

    it('should use ANNOUNCEMENT color for new_event type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-2',
          type: 'new_event',
          title: 'New Event',
          message: 'A new event was created',
        },
        'Test Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should use ROSTER_UPDATE color for slot_vacated type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-3',
          type: 'slot_vacated',
          title: 'Slot Open',
          message: 'A slot is now available',
        },
        'Test Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.ROSTER_UPDATE);
    });

    it('should use ROSTER_UPDATE color for bench_promoted type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-4',
          type: 'bench_promoted',
          title: 'Promoted!',
          message: 'You have been promoted from bench',
        },
        'Test Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.ROSTER_UPDATE);
    });

    it('should use REMINDER color for event_rescheduled type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-5',
          type: 'event_rescheduled',
          title: 'Rescheduled',
          message: 'Event was rescheduled',
        },
        'Test Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.REMINDER);
    });

    it('should use ERROR color for event_cancelled type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-cancel-1',
          type: 'event_cancelled',
          title: 'Event Cancelled',
          message: 'The event has been cancelled',
        },
        'Test Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.ERROR);
    });

    it('should use cancel emoji for event_cancelled type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-cancel-2',
          type: 'event_cancelled',
          title: 'Cancelled',
          message: 'Event cancelled',
        },
        'Community',
      );

      const json = embed.toJSON() as { title: string };
      expect(json.title).toContain('\u274C');
    });

    it('should add eventTitle field for event_cancelled when payload has eventTitle', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-cancel-3',
          type: 'event_cancelled',
          title: 'Event Cancelled',
          message: 'The raid was cancelled',
          payload: { eventTitle: 'Thursday Raid Night' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const eventField = json.fields?.find((f) => f.name === 'Event');
      expect(eventField).toBeDefined();
      expect(eventField?.value).toBe('Thursday Raid Night');
    });

    it('should include category label in footer for each notification type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-footer-1',
          type: 'new_event',
          title: 'New Event',
          message: 'A new event was created',
        },
        'My Guild',
      );

      const json = embed.toJSON() as { footer: { text: string } };
      expect(json.footer.text).toBe('My Guild \u00B7 New Event');
    });

    it('should set community name as author and category footer', async () => {
      const communityName = 'My Raid Guild';
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Test',
          message: 'Test message',
        },
        communityName,
      );

      const json = embed.toJSON() as {
        author: { name: string };
        footer: { text: string };
      };
      expect(json.author.name).toBe(communityName);
      expect(json.footer.text).toBe('My Raid Guild \u00B7 Event Reminder');
    });

    it('should include emoji in title', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'My Event',
          message: 'Test',
        },
        'Community',
      );

      const json = embed.toJSON() as { title: string };
      expect(json.title).toContain('My Event');
      expect(json.title).toContain('⏰');
    });

    it('should include "Adjust Notifications" button in action row', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Test',
          message: 'Test',
        },
        'Community',
      );

      const rowJson = row.toJSON() as { components: Array<{ label: string }> };
      const adjustButton = rowJson.components.find(
        (c) => c.label === 'Adjust Notifications',
      );
      expect(adjustButton).toBeDefined();
    });

    it('should include "View Event" button when eventId is in payload for event_reminder', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Test',
          message: 'Test',
          payload: { eventId: '42' },
        },
        'Community',
      );

      const rowJson = row.toJSON() as {
        components: Array<{ label: string; url: string }>;
      };
      const viewButton = rowJson.components.find(
        (c) => c.label === 'View Event',
      );
      expect(viewButton).toBeDefined();
      expect(viewButton?.url).toContain('/events/42');
      expect(viewButton?.url).toContain('notif=notif-1');
    });

    it('should include "Sign Up" button for new_event type when eventId present', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-2',
          type: 'new_event',
          title: 'New Event',
          message: 'Sign up now',
          payload: { eventId: '99' },
        },
        'Community',
      );

      const rowJson = row.toJSON() as {
        components: Array<{ label: string; url: string }>;
      };
      const signUpButton = rowJson.components.find(
        (c) => c.label === 'Sign Up',
      );
      expect(signUpButton).toBeDefined();
      expect(signUpButton?.url).toContain('/events/99');
    });

    it('should include "View Roster" button for slot_vacated type', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-3',
          type: 'slot_vacated',
          title: 'Slot Open',
          message: 'A slot opened',
          payload: { eventId: '10', slotName: 'Tank' },
        },
        'Community',
      );

      const rowJson = row.toJSON() as { components: Array<{ label: string }> };
      const rosterButton = rowJson.components.find(
        (c) => c.label === 'View Roster',
      );
      expect(rosterButton).toBeDefined();
    });

    it('should add eventTitle field for event_reminder when payload has eventTitle', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Coming up soon',
          payload: { eventTitle: 'Mythic Raid Night' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const eventField = json.fields?.find((f) => f.name === 'Event');
      expect(eventField).toBeDefined();
      expect(eventField?.value).toBe('Mythic Raid Night');
    });

    it('should add gameName field for new_event when payload has gameName', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-2',
          type: 'new_event',
          title: 'New Event',
          message: 'A new event',
          payload: { gameName: 'World of Warcraft' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const gameField = json.fields?.find((f) => f.name === 'Game');
      expect(gameField).toBeDefined();
      expect(gameField?.value).toBe('World of Warcraft');
    });

    it('should add slotName field for slot_vacated when payload has slotName', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-3',
          type: 'slot_vacated',
          title: 'Slot Open',
          message: 'Slot available',
          payload: { slotName: 'Healer' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const slotField = json.fields?.find((f) => f.name === 'Slot');
      expect(slotField).toBeDefined();
      expect(slotField?.value).toBe('Healer');
    });

    it('should use event start time as timestamp for event_reminder (ROK-545)', async () => {
      const eventStart = new Date('2026-02-28T21:00:00Z');
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-ts-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Your event is soon',
          payload: { eventId: 42, startTime: eventStart.toISOString() },
        },
        'Community',
      );

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBe(eventStart.getTime());
    });

    it('should use event start time for event_cancelled (ROK-545)', async () => {
      const eventStart = new Date('2026-02-28T21:00:00Z');
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-ts-2',
          type: 'event_cancelled',
          title: 'Event Cancelled',
          message: 'Cancelled',
          payload: { eventId: 42, startTime: eventStart.toISOString() },
        },
        'Community',
      );

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBe(eventStart.getTime());
    });

    it('should use current time as timestamp for non-event types (ROK-545)', async () => {
      const before = Date.now();
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-ts-3',
          type: 'achievement_unlocked',
          title: 'Achievement!',
          message: 'You got it',
        },
        'Community',
      );
      const after = Date.now();

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(json.timestamp.getTime()).toBeLessThanOrEqual(after);
    });

    it('should use newStartTime for event_rescheduled when startTime is absent (ROK-545)', async () => {
      const newStart = new Date('2026-03-01T19:00:00Z');
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-ts-4',
          type: 'event_rescheduled',
          title: 'Rescheduled',
          message: 'Event moved',
          payload: { eventId: 42, newStartTime: newStart.toISOString() },
        },
        'Community',
      );

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBe(newStart.getTime());
    });

    it('should use newStartTime (not startTime) for event_rescheduled when both are present (ROK-760)', async () => {
      const oldStart = new Date('2026-03-10T00:00:00Z');
      const newStart = new Date('2026-03-11T04:00:00Z');
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-ts-5',
          type: 'event_rescheduled',
          title: 'Rescheduled',
          message: 'Event moved',
          payload: {
            eventId: 42,
            oldStartTime: oldStart.toISOString(),
            newStartTime: newStart.toISOString(),
            startTime: oldStart.toISOString(),
          },
        },
        'Community',
      );

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBe(newStart.getTime());
    });

    it('should not add fields when payload is not provided', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Test',
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: unknown[] };
      expect(json.fields).toBeUndefined();
    });

    it('should fall back to "Raid Ledger" when communityName is empty', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Test',
          message: 'Test',
        },
        '',
      );

      const json = embed.toJSON() as {
        author: { name: string };
        footer: { text: string };
      };
      expect(json.author.name).toBe('Raid Ledger');
      expect(json.footer.text).toBe('Raid Ledger \u00B7 Event Reminder');
    });
  });

  describe('buildWelcomeEmbed', () => {
    it('should return embed and row', async () => {
      const { embed, row } = await service.buildWelcomeEmbed('Test Community');
      expect(embed).toBeDefined();
      expect(row).toBeDefined();
    });

    it('should use ANNOUNCEMENT color by default', async () => {
      const { embed } = await service.buildWelcomeEmbed('Community');
      expect(embed.toJSON().color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should use parsed accentColor when provided', async () => {
      const { embed } = await service.buildWelcomeEmbed('Community', '#38bdf8');
      // 0x38bdf8 = 3727864
      expect(embed.toJSON().color).toBe(0x38bdf8);
    });

    it('should include community name in title', async () => {
      const { embed } = await service.buildWelcomeEmbed('Community');
      const json = embed.toJSON() as { title: string };
      expect(json.title).toBe('Welcome to Community!');
    });

    it('should include Raid Ledger in description', async () => {
      const { embed } = await service.buildWelcomeEmbed('My Guild');
      const json = embed.toJSON() as { description: string };
      expect(json.description).toContain('Raid Ledger');
    });

    it('should include "Notification Settings" button in row', async () => {
      const { row } = await service.buildWelcomeEmbed('Community');
      const rowJson = row.toJSON() as {
        components: Array<{ label: string; url: string }>;
      };
      const settingsButton = rowJson.components.find(
        (c) => c.label === 'Notification Settings',
      );
      expect(settingsButton).toBeDefined();
      expect(settingsButton?.url).toContain(
        '/profile/preferences/notifications',
      );
    });

    it('should include feature fields', async () => {
      const { embed } = await service.buildWelcomeEmbed('Community');
      const json = embed.toJSON() as { fields: Array<{ name: string }> };
      const browseField = json.fields?.find(
        (f) => f.name === 'Browse & sign up for events',
      );
      const loopField = json.fields?.find((f) => f.name === 'Stay in the loop');
      const profileField = json.fields?.find(
        (f) => f.name === 'Set up your profile',
      );
      expect(browseField).toBeDefined();
      expect(loopField).toBeDefined();
      expect(profileField).toBeDefined();
    });
  });

  describe('buildBatchSummaryEmbed', () => {
    it('should include count in title', async () => {
      const { embed } = await service.buildBatchSummaryEmbed(
        'event_reminder',
        5,
        'Community',
      );

      const json = embed.toJSON() as { title: string };
      expect(json.title).toContain('5');
    });

    it('should include "Adjust Notifications" and "View All" buttons', async () => {
      const { row } = await service.buildBatchSummaryEmbed(
        'event_reminder',
        3,
        'Community',
      );

      const rowJson = row.toJSON() as { components: Array<{ label: string }> };
      const viewAll = rowJson.components.find((c) => c.label === 'View All');
      const adjust = rowJson.components.find(
        (c) => c.label === 'Adjust Notifications',
      );
      expect(viewAll).toBeDefined();
      expect(adjust).toBeDefined();
    });
  });

  describe('buildUnreachableNotificationMessage', () => {
    it('should return title and message', () => {
      const result = service.buildUnreachableNotificationMessage();
      expect(result.title).toBe('Discord DMs Unreachable');
      expect(result.message).toContain("couldn't reach you on Discord");
    });
  });
});
