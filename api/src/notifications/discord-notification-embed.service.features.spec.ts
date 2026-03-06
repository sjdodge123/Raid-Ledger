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
    ButtonStyle: {
      Link: 5,
      Danger: 4,
      Secondary: 2,
      Success: 3,
    },
  };
});

describe('DiscordNotificationEmbedService — features', () => {
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
      const prevRoleField = json.fields?.find(
        (f) => f.name === 'Previous Role',
      );
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
      const prevRoleField = json.fields?.find(
        (f) => f.name === 'Previous Role',
      );
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

    it('should return rows with Confirm, Tentative, and Decline buttons for event_rescheduled with eventId (ROK-537)', async () => {
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

      expect(rows).toBeDefined();
      expect(rows).toHaveLength(1);
      const rowJson = rows![0].toJSON() as unknown as {
        components: Array<{ customId: string; label: string; style: number }>;
      };
      expect(rowJson.components).toHaveLength(3);

      const confirmBtn = rowJson.components.find((c) => c.label === 'Confirm');
      const tentativeBtn = rowJson.components.find(
        (c) => c.label === 'Tentative',
      );
      const declineBtn = rowJson.components.find((c) => c.label === 'Decline');

      expect(confirmBtn).toBeDefined();
      expect(confirmBtn?.customId).toBe('reschedule_confirm:42');
      // ButtonStyle.Success = 3
      expect(confirmBtn?.style).toBe(3);

      expect(tentativeBtn).toBeDefined();
      expect(tentativeBtn?.customId).toBe('reschedule_tentative:42');
      // ButtonStyle.Secondary = 2
      expect(tentativeBtn?.style).toBe(2);

      expect(declineBtn).toBeDefined();
      expect(declineBtn?.customId).toBe('reschedule_decline:42');
      // ButtonStyle.Danger = 4
      expect(declineBtn?.style).toBe(4);
    });

    it('should return undefined rows for event_rescheduled without eventId', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-5b',
          type: 'event_rescheduled',
          title: 'Rescheduled',
          message: 'Event rescheduled',
          // no payload / no eventId
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

  describe('role_gap_alert embed (ROK-536)', () => {
    it('should use REMINDER color for role_gap_alert type', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-1',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing 1 tank',
        },
        'Community',
      );

      expect(embed.toJSON().color).toBe(EMBED_COLORS.REMINDER);
    });

    it('should use warning emoji for role_gap_alert', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-2',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing roles',
        },
        'Community',
      );

      const json = embed.toJSON() as { title: string };
      expect(json.title).toContain('\u26A0\uFE0F');
    });

    it('should include "Role Gap Alert" in footer category', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-3',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing roles',
        },
        'My Guild',
      );

      const json = embed.toJSON() as { footer: { text: string } };
      expect(json.footer.text).toBe('My Guild \u00B7 Role Gap Alert');
    });

    it('should add Event, Missing Roles, and Roster fields from payload', async () => {
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-4',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing 1 tank',
          payload: {
            eventId: 42,
            eventTitle: 'Mythic Raid',
            gapSummary: 'Missing 1 tank',
            rosterSummary: 'Tanks: 1/2 | Healers: 4/4',
          },
        },
        'Community',
      );

      const json = embed.toJSON() as {
        fields: Array<{ name: string; value: string }>;
      };
      const eventField = json.fields?.find((f) => f.name === 'Event');
      expect(eventField?.value).toBe('Mythic Raid');

      const gapField = json.fields?.find((f) => f.name === 'Missing Roles');
      expect(gapField?.value).toBe('Missing 1 tank');

      const rosterField = json.fields?.find((f) => f.name === 'Roster');
      expect(rosterField?.value).toBe('Tanks: 1/2 | Healers: 4/4');
    });

    it('should include "View Event" primary button for role_gap_alert', async () => {
      const { row } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-5',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing roles',
          payload: { eventId: 42 },
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
    });

    it('should return extra rows with Cancel Event and Reschedule link buttons', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-6',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing roles',
          payload: {
            eventId: 42,
            suggestedReason: 'Not enough tank — missing 1 tank',
          },
        },
        'Community',
      );

      expect(rows).toBeDefined();
      expect(rows).toHaveLength(1);

      const rowJson = rows![0].toJSON() as unknown as {
        components: Array<{ label: string; url: string; style: number }>;
      };
      expect(rowJson.components).toHaveLength(2);

      const cancelBtn = rowJson.components.find(
        (c) => c.label === 'Cancel Event',
      );
      expect(cancelBtn).toBeDefined();
      expect(cancelBtn?.url).toContain('/events/42?action=cancel');
      expect(cancelBtn?.url).toContain('reason=');
      // ButtonStyle.Link = 5
      expect(cancelBtn?.style).toBe(5);

      const rescheduleBtn = rowJson.components.find(
        (c) => c.label === 'Reschedule',
      );
      expect(rescheduleBtn).toBeDefined();
      expect(rescheduleBtn?.url).toContain('/events/42?action=reschedule');
      expect(rescheduleBtn?.style).toBe(5);
    });

    it('should use event start time as timestamp for role_gap_alert (ROK-545)', async () => {
      const eventStart = new Date('2026-03-04T21:00:00Z');
      const { embed } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-7',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing roles',
          payload: { eventId: 42, startTime: eventStart.toISOString() },
        },
        'Community',
      );

      const json = embed.toJSON() as unknown as { timestamp: Date };
      expect(json.timestamp.getTime()).toBe(eventStart.getTime());
    });

    it('should omit extra rows when eventId is missing for role_gap_alert', async () => {
      const { rows } = await service.buildNotificationEmbed(
        {
          notificationId: 'notif-gap-8',
          type: 'role_gap_alert',
          title: 'Role Gap Alert',
          message: 'Missing roles',
        },
        'Community',
      );

      expect(rows).toBeUndefined();
    });
  });
});
