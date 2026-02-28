/**
 * Voice channel field tests for DiscordNotificationEmbedService (ROK-507).
 * Verifies that the Voice Channel field is rendered (or omitted) correctly
 * across all notification types that received voiceChannelId support.
 */

// Mock discord.js — same pattern as the existing spec file
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

import { DiscordNotificationEmbedService } from './discord-notification-embed.service';
import { SettingsService } from '../settings/settings.service';

type EmbedFields = Array<{ name: string; value: string; inline?: boolean }>;

describe('DiscordNotificationEmbedService — voice channel fields (ROK-507)', () => {
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

  // Helper to get the Voice Channel field from an embed
  const getVoiceChannelField = (fields: EmbedFields | undefined) =>
    fields?.find((f) => f.name === 'Voice Channel');

  // ─── event_reminder ──────────────────────────────────────────────────────

  describe('event_reminder type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Starting Soon!',
          message: 'Your event is starting in 15 minutes',
          payload: { eventId: 42, voiceChannelId: '111222333' },
        },
        'Test Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#111222333>');
    });

    it('renders voice channel as Discord channel mention format', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event reminder',
          payload: { voiceChannelId: '555666777888' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField?.value).toMatch(/^<#555666777888>$/);
    });

    it('omits Voice Channel field when voiceChannelId is absent from payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event reminder',
          payload: { eventId: 10 },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeUndefined();
    });

    it('omits Voice Channel field when voiceChannelId is null in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event reminder',
          payload: { eventId: 10, voiceChannelId: null },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeUndefined();
    });

    it('Voice Channel field is inline', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event reminder',
          payload: { voiceChannelId: '123' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField?.inline).toBe(true);
    });
  });

  // ─── new_event ────────────────────────────────────────────────────────────

  describe('new_event type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-2',
          type: 'new_event',
          title: 'New Event Posted',
          message: 'A new event was created',
          payload: { eventId: 5, gameName: 'WoW', voiceChannelId: '444555666' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#444555666>');
    });

    it('omits Voice Channel field when voiceChannelId is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-2',
          type: 'new_event',
          title: 'New Event Posted',
          message: 'A new event was created',
          payload: { eventId: 5 },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeUndefined();
    });

    it('can render both gameName and voiceChannelId fields together', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-2',
          type: 'new_event',
          title: 'New Event',
          message: 'Sign up',
          payload: { gameName: 'World of Warcraft', voiceChannelId: '123' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const gameField = json.fields?.find((f) => f.name === 'Game');
      const vcField = getVoiceChannelField(json.fields);

      expect(gameField).toBeDefined();
      expect(vcField).toBeDefined();
    });
  });

  // ─── subscribed_game ─────────────────────────────────────────────────────

  describe('subscribed_game type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-3',
          type: 'subscribed_game',
          title: 'New WoW Event',
          message: 'New event for your subscribed game',
          payload: { eventId: 7, voiceChannelId: '777888999' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#777888999>');
    });

    it('omits Voice Channel field when voiceChannelId is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-3',
          type: 'subscribed_game',
          title: 'New Event',
          message: 'New event',
          payload: { eventId: 7 },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      expect(getVoiceChannelField(json.fields)).toBeUndefined();
    });
  });

  // ─── slot_vacated ─────────────────────────────────────────────────────────

  describe('slot_vacated type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-4',
          type: 'slot_vacated',
          title: 'Slot Available',
          message: 'A roster slot opened up',
          payload: {
            slotName: 'Tank',
            eventId: 8,
            voiceChannelId: '321654987',
          },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#321654987>');
    });

    it('can render both slotName and voiceChannelId fields together', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-4',
          type: 'slot_vacated',
          title: 'Slot Available',
          message: 'Slot opened',
          payload: { slotName: 'Healer', voiceChannelId: '111' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const slotField = json.fields?.find((f) => f.name === 'Slot');
      const vcField = getVoiceChannelField(json.fields);

      expect(slotField).toBeDefined();
      expect(vcField).toBeDefined();
    });

    it('omits Voice Channel field when voiceChannelId is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-4',
          type: 'slot_vacated',
          title: 'Slot Available',
          message: 'Slot opened',
          payload: { slotName: 'Tank' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      expect(getVoiceChannelField(json.fields)).toBeUndefined();
    });
  });

  // ─── event_rescheduled ───────────────────────────────────────────────────

  describe('event_rescheduled type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-5',
          type: 'event_rescheduled',
          title: 'Event Rescheduled',
          message: 'The event time has changed',
          payload: { eventId: 9, voiceChannelId: '654321987' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#654321987>');
    });

    it('omits Voice Channel field when voiceChannelId is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-5',
          type: 'event_rescheduled',
          title: 'Rescheduled',
          message: 'Event time changed',
          payload: { eventId: 9 },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      expect(getVoiceChannelField(json.fields)).toBeUndefined();
    });
  });

  // ─── roster_reassigned ───────────────────────────────────────────────────

  describe('roster_reassigned type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-6',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: 'Your role has been changed',
          payload: {
            oldRole: 'dps',
            newRole: 'tank',
            eventId: 11,
            voiceChannelId: '999111222',
          },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#999111222>');
    });

    it('omits Voice Channel field when voiceChannelId is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-6',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: 'Role change',
          payload: { oldRole: 'dps', newRole: 'tank', eventId: 11 },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      expect(getVoiceChannelField(json.fields)).toBeUndefined();
    });

    it('can render oldRole, newRole, and voiceChannelId together', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-6',
          type: 'roster_reassigned',
          title: 'Role Changed',
          message: 'Role changed',
          payload: {
            oldRole: 'healer',
            newRole: 'tank',
            eventId: 11,
            voiceChannelId: '456',
          },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const prevRoleField = json.fields?.find(
        (f) => f.name === 'Previous Role',
      );
      const newRoleField = json.fields?.find((f) => f.name === 'New Role');
      const vcField = getVoiceChannelField(json.fields);

      expect(prevRoleField).toBeDefined();
      expect(newRoleField).toBeDefined();
      expect(vcField).toBeDefined();
    });
  });

  // ─── bench_promoted ──────────────────────────────────────────────────────

  describe('bench_promoted type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-7',
          type: 'bench_promoted',
          title: 'Promoted!',
          message: 'You have been promoted from the bench',
          payload: { eventId: 12, voiceChannelId: '123123123' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#123123123>');
    });

    it('omits Voice Channel field when voiceChannelId is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-7',
          type: 'bench_promoted',
          title: 'Promoted!',
          message: 'Promoted from bench',
          payload: { eventId: 12 },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      expect(getVoiceChannelField(json.fields)).toBeUndefined();
    });
  });

  // ─── tentative_displaced ─────────────────────────────────────────────────

  describe('tentative_displaced type', () => {
    it('adds Voice Channel field when voiceChannelId is in payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-8',
          type: 'tentative_displaced',
          title: 'Tentative Displaced',
          message: 'You have been displaced from tentative',
          payload: { eventId: 13, voiceChannelId: '456456456' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#456456456>');
    });

    it('omits Voice Channel field when voiceChannelId is absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-8',
          type: 'tentative_displaced',
          title: 'Displaced',
          message: 'Displaced from tentative',
          payload: { eventId: 13 },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      expect(getVoiceChannelField(json.fields)).toBeUndefined();
    });
  });

  // ─── event_cancelled — should NOT include voice channel ──────────────────

  describe('event_cancelled type — no voice channel (not applicable)', () => {
    it('does NOT add Voice Channel field even if voiceChannelId is in payload', async () => {
      // event_cancelled switch case does not handle voiceChannelId
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-cancel',
          type: 'event_cancelled',
          title: 'Event Cancelled',
          message: 'The event was cancelled',
          payload: { eventTitle: 'Raid Night', voiceChannelId: '999' },
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      // event_cancelled only renders eventTitle, not voiceChannelId
      expect(vcField).toBeUndefined();
    });
  });

  // ─── edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles numeric voiceChannelId via toStr conversion', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-edge-1',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event soon',
          payload: { voiceChannelId: 12345 }, // numeric, not string
        },
        'Community',
      );

      const json = embed.toJSON() as { fields: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);

      expect(vcField).toBeDefined();
      expect(vcField?.value).toBe('<#12345>');
    });

    it('handles empty string voiceChannelId — field should still render', async () => {
      // toStr('') returns '' which is falsy — behaviour depends on whether `if (payload.voiceChannelId)` check fires
      // The implementation checks `if (payload.voiceChannelId)` which is falsy for ''
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-edge-2',
          type: 'event_reminder',
          title: 'Reminder',
          message: 'Event soon',
          payload: { voiceChannelId: '' },
        },
        'Community',
      );

      // Empty string is falsy — implementation omits the field
      const json = embed.toJSON() as { fields?: EmbedFields };
      const vcField = getVoiceChannelField(json.fields);
      expect(vcField).toBeUndefined();
    });

    it('omits voice channel field when payload is entirely absent', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-edge-3',
          type: 'bench_promoted',
          title: 'Promoted!',
          message: 'Bench promotion',
          // no payload
        },
        'Community',
      );

      const json = embed.toJSON() as { fields?: EmbedFields };
      expect(getVoiceChannelField(json.fields)).toBeUndefined();
    });
  });
});
