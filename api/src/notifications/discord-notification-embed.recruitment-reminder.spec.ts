/**
 * Tests for recruitment_reminder additions to DiscordNotificationEmbedService (ROK-535).
 * Covers: color, emoji, label, fields, primary button, timestamp, and extra rows.
 */
import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { SettingsService } from '../settings/settings.service';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

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
    setTimestamp(ts?: Date) {
      this.data.timestamp = ts ?? new Date();
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
    ButtonStyle: { Link: 5, Danger: 4, Secondary: 2, Success: 3 },
  };
});

describe('DiscordNotificationEmbedService — recruitment_reminder (ROK-535)', () => {
  let service: DiscordNotificationEmbedService;
  let mockSettingsService: { getClientUrl: jest.Mock };

  beforeEach(() => {
    mockSettingsService = {
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    };
    service = new DiscordNotificationEmbedService(
      mockSettingsService as unknown as SettingsService,
    );
  });

  describe('color', () => {
    it('should use ANNOUNCEMENT color for recruitment_reminder', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-1',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Come sign up!',
        },
        'Test Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });
  });

  describe('emoji', () => {
    it('should use the megaphone emoji (📢) for recruitment_reminder', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-2',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up now',
        },
        'My Guild',
      );

      const json = embed.toJSON() as { title: string };
      expect(json.title).toContain('📢');
    });
  });

  describe('type label', () => {
    it('should display "Recruitment Reminder" as footer category label', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-3',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
        },
        'My Guild',
      );

      const json = embed.toJSON() as { footer: { text: string } };
      expect(json.footer.text).toBe('My Guild \u00B7 Recruitment Reminder');
    });
  });

  describe('type-specific fields', () => {
    it('should add Event field when payload has eventTitle', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-4',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { eventTitle: 'Mythic Raid Night', eventId: 42 },
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

    it('should add Signups field when payload has signupSummary', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-5',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { signupSummary: '10/20 spots filled', eventId: 42 },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const signupsField = json.fields?.find((f) => f.name === 'Signups');
      expect(signupsField).toBeDefined();
      expect(signupsField?.value).toBe('10/20 spots filled');
    });

    it('should add Game field when payload has gameName', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-6',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { gameName: 'World of Warcraft', eventId: 42 },
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

    it('should add Voice Channel field when payload has voiceChannelId', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-7',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { voiceChannelId: 'vc-123', eventId: 42 },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const vcField = json.fields?.find((f) => f.name === 'Voice Channel');
      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#vc-123>');
    });

    it('should add all four fields when all payload values are present', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-8',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: {
            eventTitle: 'Mythic Raid Night',
            signupSummary: '10/20 spots filled',
            gameName: 'World of Warcraft',
            voiceChannelId: 'vc-999',
            eventId: 42,
          },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: Array<{ name: string }> };
      const fieldNames = json.fields?.map((f) => f.name) ?? [];
      expect(fieldNames).toContain('Event');
      expect(fieldNames).toContain('Signups');
      expect(fieldNames).toContain('Game');
      expect(fieldNames).toContain('Voice Channel');
    });

    it('should not add fields when payload is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-9',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: unknown[] };
      expect(json.fields).toBeUndefined();
    });

    it('should not add optional fields when their payload values are absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-10',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { eventId: 42 }, // only eventId — no eventTitle, signupSummary, gameName, voiceChannelId
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: Array<{ name: string }> };
      // No additional fields should be added since none of the optional payload keys are set
      expect(json.fields).toBeUndefined();
    });
  });

  describe('primary action button', () => {
    it('should use "View Event" label for recruitment_reminder', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-11',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { eventId: 42 },
        },
        'Community',
      );

      const rowJson = row.toJSON() as {
        components: Array<{ label: string; url: string }>;
      };
      const viewEventBtn = rowJson.components.find((c) => c.label === 'View Event');
      expect(viewEventBtn).toBeDefined();
    });

    it('should URL-encode the eventId and notif in the View Event button URL', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-12',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { eventId: 99 },
        },
        'Community',
      );

      const rowJson = row.toJSON() as {
        components: Array<{ label: string; url: string }>;
      };
      const viewEventBtn = rowJson.components.find((c) => c.label === 'View Event');
      expect(viewEventBtn?.url).toContain('/events/99');
      expect(viewEventBtn?.url).toContain('notif=notif-rr-12');
    });

    it('should not include Sign Up button when eventId is absent from payload', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-13',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          // no payload.eventId
        },
        'Community',
      );

      const rowJson = row.toJSON() as { components: Array<{ label: string }> };
      const signUpBtn = rowJson.components.find((c) => c.label === 'Sign Up');
      expect(signUpBtn).toBeUndefined();
    });

    it('should include "View in Discord" button when discordUrl is in payload', async () => {
      const discordUrl = 'https://discord.com/channels/guild/channel/msg';
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-14',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { eventId: 42, discordUrl },
        },
        'Community',
      );

      const rowJson = row.toJSON() as {
        components: Array<{ label: string; url: string }>;
      };
      const discordBtn = rowJson.components.find(
        (c) => c.label === 'View in Discord',
      );
      expect(discordBtn).toBeDefined();
      expect(discordBtn?.url).toBe(discordUrl);
    });

    it('should always include Adjust Notifications button', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-15',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
        },
        'Community',
      );

      const rowJson = row.toJSON() as { components: Array<{ label: string }> };
      const adjustBtn = rowJson.components.find(
        (c) => c.label === 'Adjust Notifications',
      );
      expect(adjustBtn).toBeDefined();
    });
  });

  describe('extra rows', () => {
    it('should return Sign Up / Tentative / Decline interactive buttons for recruitment_reminder', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-16',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { eventId: 42 },
        },
        'Community',
      );

      expect(rows).toBeDefined();
      expect(rows).toHaveLength(1);
      const rowJson = rows![0].toJSON() as {
        components: Array<{ label: string; customId?: string }>;
      };
      const labels = rowJson.components.map((c) => c.label);
      expect(labels).toEqual(['Sign Up', 'Tentative', 'Decline']);
    });
  });

  describe('timestamp', () => {
    it('should use event startTime as embed timestamp for recruitment_reminder', async () => {
      const eventStart = new Date('2026-03-04T20:00:00Z');
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-17',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          payload: { eventId: 42, startTime: eventStart.toISOString() },
        },
        'Community',
      );

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBe(eventStart.getTime());
    });

    it('should fall back to current time when startTime is absent', async () => {
      const before = Date.now();
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-rr-18',
          type: 'recruitment_reminder',
          title: 'Spots Available',
          message: 'Sign up!',
          // no startTime
        },
        'Community',
      );
      const after = Date.now();

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(json.timestamp.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('batch summary embed', () => {
    it('should use recruitment_reminder type in batch summary', async () => {
      const { embed } = await service.buildBatchSummaryEmbed(
        'recruitment_reminder',
        3,
        'My Guild',
      );

      const json = embed.toJSON() as { title: string };
      expect(json.title).toContain('3');
      expect(json.title).toContain('📢');
    });
  });
});
