import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { SettingsService } from '../settings/settings.service';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

// Mock discord.js so we can test without real Discord connections
jest.mock('discord.js', () => {
  class MockEmbedBuilder {
    private data: Record<string, unknown> = {};

    setAuthor(author: unknown) {
      this.data.author = author;
      return this;
    }
    setTitle(title: string) {
      this.data.title = title;
      return this;
    }
    setDescription(description: string) {
      this.data.description = description;
      return this;
    }
    setColor(color: number) {
      this.data.color = color;
      return this;
    }
    setFooter(footer: unknown) {
      this.data.footer = footer;
      return this;
    }
    setTimestamp() {
      return this;
    }
    addFields(...fields: unknown[]) {
      if (!this.data.fields) this.data.fields = [];
      (this.data.fields as unknown[]).push(...fields);
      return this;
    }
    toJSON() {
      return this.data;
    }
  }

  class MockButtonBuilder {
    private data: Record<string, unknown> = {};

    setCustomId(customId: string) {
      this.data.customId = customId;
      return this;
    }
    setLabel(label: string) {
      this.data.label = label;
      return this;
    }
    setStyle(style: number) {
      this.data.style = style;
      return this;
    }
    setURL(url: string) {
      this.data.url = url;
      return this;
    }
    setEmoji(emoji: string) {
      this.data.emoji = emoji;
      return this;
    }
    setDisabled(disabled: boolean) {
      this.data.disabled = disabled;
      return this;
    }
    toJSON() {
      return this.data;
    }
  }

  class MockActionRowBuilder {
    private components: Array<{ toJSON: () => unknown }> = [];

    addComponents(
      ...args: Array<
        { toJSON: () => unknown } | Array<{ toJSON: () => unknown }>
      >
    ) {
      for (const arg of args) {
        if (Array.isArray(arg)) {
          this.components.push(...arg);
        } else {
          this.components.push(arg);
        }
      }
      return this;
    }
    toJSON() {
      return { components: this.components.map((c) => c.toJSON()) };
    }
  }

  return {
    EmbedBuilder: MockEmbedBuilder,
    ButtonBuilder: MockButtonBuilder,
    ActionRowBuilder: MockActionRowBuilder,
    ButtonStyle: {
      Link: 5,
      Danger: 4,
      Secondary: 2,
    },
  };
});

describe('DiscordNotificationEmbedService', () => {
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

    it('should set community name as author and footer', async () => {
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
      expect(json.footer.text).toBe(communityName);
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
      expect(json.footer.text).toBe('Raid Ledger');
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

  describe('roster_reassigned embed — ROK-487 generic roster fields', () => {
    it('should omit "New Role" field when newRole is player', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-10',
          type: 'roster_reassigned',
          title: 'Roster Assignment',
          message: "You've been assigned to the roster for Game Night",
          payload: { oldRole: null, newRole: 'player', eventId: '5' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields?: Array<{ name: string; value: string }>;
      };
      const newRoleField = json.fields?.find((f) => f.name === 'New Role');
      expect(newRoleField).toBeUndefined();
    });

    it('should include "New Role" field when newRole is tank', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-11',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: "You've been assigned to the Tank role",
          payload: { oldRole: 'healer', newRole: 'tank', eventId: '5' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const newRoleField = json.fields?.find((f) => f.name === 'New Role');
      expect(newRoleField).toBeDefined();
      expect(newRoleField?.value).toBe('tank');
    });

    it('should include "New Role" field when newRole is healer', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-12',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: "You've been assigned to the Healer role",
          payload: { oldRole: 'dps', newRole: 'healer', eventId: '5' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const newRoleField = json.fields?.find((f) => f.name === 'New Role');
      expect(newRoleField).toBeDefined();
      expect(newRoleField?.value).toBe('healer');
    });

    it('should include "New Role" field when newRole is dps', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-13',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: "You've been assigned to the DPS role",
          payload: { oldRole: 'tank', newRole: 'dps', eventId: '5' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const newRoleField = json.fields?.find((f) => f.name === 'New Role');
      expect(newRoleField).toBeDefined();
      expect(newRoleField?.value).toBe('dps');
    });

    it('should include "New Role" field when newRole is flex', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-14',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: "You've been assigned to the Flex role",
          payload: { oldRole: 'dps', newRole: 'flex', eventId: '5' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const newRoleField = json.fields?.find((f) => f.name === 'New Role');
      expect(newRoleField).toBeDefined();
      expect(newRoleField?.value).toBe('flex');
    });

    it('should include "Previous Role" field when oldRole is present', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-15',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: 'Your role changed',
          payload: { oldRole: 'healer', newRole: 'tank', eventId: '5' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const prevRoleField = json.fields?.find((f) => f.name === 'Previous Role');
      expect(prevRoleField).toBeDefined();
      expect(prevRoleField?.value).toBe('healer');
    });

    it('should omit "Previous Role" field when oldRole is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-16',
          type: 'roster_reassigned',
          title: 'Roster Assignment',
          message: 'Assigned to roster',
          payload: { newRole: 'tank', eventId: '5' },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields?: Array<{ name: string; value: string }>;
      };
      const prevRoleField = json.fields?.find((f) => f.name === 'Previous Role');
      expect(prevRoleField).toBeUndefined();
    });
  });

  describe('buildExtraRows — Roach Out button (ROK-378)', () => {
    it('should return a rows array with Roach Out button for event_reminder with eventId', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Your event is soon',
          payload: { eventId: 42 },
        },
        'Community',
      );

      expect(rows).toBeDefined();
      expect(rows).toHaveLength(1);
    });

    it('should set customId with ROACH_OUT prefix and eventId for the button', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Your event is soon',
          payload: { eventId: 99 },
        },
        'Community',
      );

      const rowJson = rows![0].toJSON() as unknown as {
        components: Array<{ customId: string; label: string; style: number }>;
      };
      const roachBtn = rowJson.components[0];
      expect(roachBtn.customId).toContain('event_roachout');
      expect(roachBtn.customId).toContain('99');
      expect(roachBtn.label).toBe('Roach Out');
      // ButtonStyle.Danger = 4
      expect(roachBtn.style).toBe(4);
    });

    it('should handle numeric eventId correctly in customId', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event soon',
          payload: { eventId: 123 },
        },
        'Community',
      );

      const rowJson = rows![0].toJSON() as unknown as {
        components: Array<{ customId: string }>;
      };
      expect(rowJson.components[0].customId).toBe('event_roachout:123');
    });

    it('should return undefined rows for event_reminder without eventId', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Your event is soon',
          // no payload.eventId
        },
        'Community',
      );

      expect(rows).toBeUndefined();
    });

    it('should return undefined rows for new_event type', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-2',
          type: 'new_event',
          title: 'New Event',
          message: 'New event created',
          payload: { eventId: 42 },
        },
        'Community',
      );

      expect(rows).toBeUndefined();
    });

    it('should return undefined rows for slot_vacated type', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-3',
          type: 'slot_vacated',
          title: 'Slot Open',
          message: 'A slot opened',
          payload: { eventId: 42 },
        },
        'Community',
      );

      expect(rows).toBeUndefined();
    });

    it('should return undefined rows for bench_promoted type', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-4',
          type: 'bench_promoted',
          title: 'Promoted!',
          message: 'You were promoted',
          payload: { eventId: 42 },
        },
        'Community',
      );

      expect(rows).toBeUndefined();
    });

    it('should return undefined rows for event_rescheduled type', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-5',
          type: 'event_rescheduled',
          title: 'Rescheduled',
          message: 'Event rescheduled',
          payload: { eventId: 42 },
        },
        'Community',
      );

      expect(rows).toBeUndefined();
    });

    it('should return undefined rows for event_reminder when payload.eventId is null', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Your event is soon',
          payload: { eventId: null },
        },
        'Community',
      );

      expect(rows).toBeUndefined();
    });

    it('should handle string eventId in payload (toStr conversion)', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event soon',
          payload: { eventId: '77' },
        },
        'Community',
      );

      const rowJson = rows![0].toJSON() as unknown as {
        components: Array<{ customId: string }>;
      };
      expect(rowJson.components[0].customId).toBe('event_roachout:77');
    });
  });
});
