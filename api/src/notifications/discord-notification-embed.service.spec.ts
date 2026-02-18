import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
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
    },
  };
});

describe('DiscordNotificationEmbedService', () => {
  let service: DiscordNotificationEmbedService;

  beforeEach(() => {
    delete process.env.CLIENT_URL;
    service = new DiscordNotificationEmbedService();
  });

  describe('buildNotificationEmbed', () => {
    it('should return an embed and row', () => {
      const { embed, row } = service.buildNotificationEmbed(
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

    it('should use REMINDER color for event_reminder type', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should use ANNOUNCEMENT color for new_event type', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should use ROSTER_UPDATE color for slot_vacated type', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should use ROSTER_UPDATE color for bench_promoted type', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should use REMINDER color for event_rescheduled type', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should set community name as author and footer', () => {
      const communityName = 'My Raid Guild';
      const { embed } = service.buildNotificationEmbed(
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

    it('should include emoji in title', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should include "Adjust Notifications" button in action row', () => {
      process.env.CLIENT_URL = 'http://localhost:5173';
      service = new DiscordNotificationEmbedService();

      const { row } = service.buildNotificationEmbed(
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

    it('should include "View Event" button when eventId is in payload for event_reminder', () => {
      process.env.CLIENT_URL = 'http://localhost:5173';
      service = new DiscordNotificationEmbedService();

      const { row } = service.buildNotificationEmbed(
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

    it('should include "Sign Up" button for new_event type when eventId present', () => {
      process.env.CLIENT_URL = 'http://localhost:5173';
      service = new DiscordNotificationEmbedService();

      const { row } = service.buildNotificationEmbed(
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

    it('should include "View Roster" button for slot_vacated type', () => {
      process.env.CLIENT_URL = 'http://localhost:5173';
      service = new DiscordNotificationEmbedService();

      const { row } = service.buildNotificationEmbed(
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

    it('should add eventTitle field for event_reminder when payload has eventTitle', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should add gameName field for new_event when payload has gameName', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should add slotName field for slot_vacated when payload has slotName', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should not add fields when payload is not provided', () => {
      const { embed } = service.buildNotificationEmbed(
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

    it('should fall back to "Raid Ledger" when communityName is empty', () => {
      const { embed } = service.buildNotificationEmbed(
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
    it('should return embed and row', () => {
      const { embed, row } = service.buildWelcomeEmbed('Test Community');
      expect(embed).toBeDefined();
      expect(row).toBeDefined();
    });

    it('should use ANNOUNCEMENT color by default', () => {
      const { embed } = service.buildWelcomeEmbed('Community');
      expect(embed.toJSON().color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should use parsed accentColor when provided', () => {
      const { embed } = service.buildWelcomeEmbed('Community', '#38bdf8');
      // 0x38bdf8 = 3727864
      expect(embed.toJSON().color).toBe(0x38bdf8);
    });

    it('should include "Welcome to Discord Notifications!" title', () => {
      const { embed } = service.buildWelcomeEmbed('Community');
      const json = embed.toJSON() as { title: string };
      expect(json.title).toBe('Welcome to Discord Notifications!');
    });

    it('should include community name in description', () => {
      const { embed } = service.buildWelcomeEmbed('My Guild');
      const json = embed.toJSON() as { description: string };
      expect(json.description).toContain('My Guild');
    });

    it('should include "Notification Settings" button in row', () => {
      process.env.CLIENT_URL = 'http://localhost:5173';
      service = new DiscordNotificationEmbedService();

      const { row } = service.buildWelcomeEmbed('Community');
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

    it('should include fields about what you will receive', () => {
      const { embed } = service.buildWelcomeEmbed('Community');
      const json = embed.toJSON() as { fields: Array<{ name: string }> };
      const whatYouReceiveField = json.fields?.find(
        (f) => f.name === "What you'll receive",
      );
      expect(whatYouReceiveField).toBeDefined();
    });
  });

  describe('buildBatchSummaryEmbed', () => {
    it('should include count in title', () => {
      const { embed } = service.buildBatchSummaryEmbed(
        'event_reminder',
        5,
        'Community',
      );

      const json = embed.toJSON() as { title: string };
      expect(json.title).toContain('5');
    });

    it('should include "Adjust Notifications" and "View All" buttons', () => {
      process.env.CLIENT_URL = 'http://localhost:5173';
      service = new DiscordNotificationEmbedService();

      const { row } = service.buildBatchSummaryEmbed(
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
