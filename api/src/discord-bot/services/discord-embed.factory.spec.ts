import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import { EMBED_COLORS, EMBED_STATES } from '../discord-bot.constants';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** Unicode fallback map — mirrors DiscordEmojiService behavior when no custom emojis. */
const UNICODE_FALLBACK: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

describe('DiscordEmbedFactory', () => {
  let factory: DiscordEmbedFactory;
  let emojiService: DiscordEmojiService;

  const baseEvent: EmbedEventData = {
    id: 42,
    title: 'Mythic Raid Night',
    description: 'Weekly mythic progression',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: 15,
    maxAttendees: 20,
    slotConfig: {
      type: 'mmo',
      tank: 2,
      healer: 4,
      dps: 14,
    },
    game: {
      name: 'World of Warcraft',
      coverUrl: 'https://example.com/wow-art.jpg',
    },
  };

  const baseContext: EmbedContext = {
    communityName: 'Test Guild',
    clientUrl: 'http://localhost:5173',
  };

  beforeEach(() => {
    emojiService = {
      getRoleEmoji: jest.fn((role: string) => UNICODE_FALLBACK[role] ?? ''),
      isUsingCustomEmojis: jest.fn(() => false),
    } as unknown as DiscordEmojiService;
    factory = new DiscordEmbedFactory(emojiService);
  });

  describe('buildEventEmbed', () => {
    it('should build an embed with cyan color by default (posted state)', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should set the title with calendar emoji prefix', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.title).toBe('📅 Mythic Raid Night');
    });

    it('should set the author to Raid Ledger', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.author?.name).toBe('Raid Ledger');
    });

    it('should include game name in the description', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('World of Warcraft');
    });

    it('should include Discord native timestamp in the description', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      // 2026-02-20T20:00:00.000Z = Unix 1771617600
      expect(json.description).toContain('📆');
      expect(json.description).toContain('<t:1771617600:f>');
      expect(json.description).toContain('<t:1771617600:R>');
    });

    it('should include duration in the description', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('3h');
    });

    it('should include roster breakdown for MMO slot config', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('ROSTER:');
      expect(json.description).toContain('**Tanks** (');
      expect(json.description).toContain('**Healers** (');
      expect(json.description).toContain('**DPS** (');
    });

    it('should set game art as thumbnail', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.thumbnail?.url).toBe('https://example.com/wow-art.jpg');
    });

    it('should include community name in footer', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.footer?.text).toBe('Test Guild');
    });

    it('should set URL on title for clickable link (ROK-399)', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.url).toBe('http://localhost:5173/events/42');
    });

    it('should include signup action buttons by default', () => {
      const { row } = factory.buildEventEmbed(baseEvent, baseContext);

      expect(row).toBeDefined();
      const components = row!.toJSON().components as {
        label?: string;
        url?: string;
        custom_id?: string;
        style?: number;
      }[];
      expect(components).toHaveLength(4);
      expect(components[0].label).toBe('Sign Up');
      expect(components[0].style).toBe(3); // ButtonStyle.Success
      expect(components[1].label).toBe('Tentative');
      expect(components[2].label).toBe('Decline');
      expect(components[3].label).toBe('View Event');
      expect(components[3].url).toBe('http://localhost:5173/events/42');
    });

    it('should handle events without game data', () => {
      const noGameEvent: EmbedEventData = {
        ...baseEvent,
        game: null,
      };

      const { embed } = factory.buildEventEmbed(noGameEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).not.toContain('🎮');
      expect(json.thumbnail).toBeUndefined();
    });

    it('should handle events without slot config', () => {
      const simpleEvent: EmbedEventData = {
        ...baseEvent,
        slotConfig: null,
        maxAttendees: 10,
        signupCount: 5,
      };

      const { embed } = factory.buildEventEmbed(simpleEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('ROSTER: 5/10');
    });

    it('should handle events without max attendees or slot config', () => {
      const openEvent: EmbedEventData = {
        ...baseEvent,
        slotConfig: null,
        maxAttendees: null,
        signupCount: 3,
      };

      const { embed } = factory.buildEventEmbed(openEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('3 signed up');
    });

    it('should not include roster line when no signups and no max', () => {
      const emptyEvent: EmbedEventData = {
        ...baseEvent,
        slotConfig: null,
        maxAttendees: null,
        signupCount: 0,
      };

      const { embed } = factory.buildEventEmbed(emptyEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).not.toContain('ROSTER');
    });

    it('should omit View Event link button when no client URL but keep signup buttons', () => {
      const noUrlContext: EmbedContext = {
        communityName: 'Test',
        clientUrl: null,
      };
      const origEnv = process.env.CLIENT_URL;
      delete process.env.CLIENT_URL;

      const { row } = factory.buildEventEmbed(baseEvent, noUrlContext);

      expect(row).toBeDefined();
      const components = row!.toJSON().components as { label?: string }[];
      // Should have 3 signup buttons but no View Event link
      expect(components).toHaveLength(3);
      expect(components[0].label).toBe('Sign Up');
      expect(components[1].label).toBe('Tentative');
      expect(components[2].label).toBe('Decline');

      process.env.CLIENT_URL = origEnv;
    });

    it('should use fallback community name when not set', () => {
      const noNameContext: EmbedContext = {
        communityName: null,
        clientUrl: 'http://localhost:5173',
      };

      const { embed } = factory.buildEventEmbed(baseEvent, noNameContext);
      const json = embed.toJSON();

      expect(json.footer?.text).toBe('Raid Ledger');
    });

    it('should use "view" button mode with only View Event link', () => {
      const { row } = factory.buildEventEmbed(baseEvent, baseContext, {
        buttons: 'view',
      });

      expect(row).toBeDefined();
      const components = row!.toJSON().components as {
        label?: string;
        url?: string;
      }[];
      expect(components).toHaveLength(1);
      expect(components[0].label).toBe('View Event');
      expect(components[0].url).toBe('http://localhost:5173/events/42');
    });

    it('should omit row with "view" button mode when no client URL', () => {
      const origEnv = process.env.CLIENT_URL;
      delete process.env.CLIENT_URL;

      const { row } = factory.buildEventEmbed(
        baseEvent,
        {
          communityName: 'Test',
          clientUrl: null,
        },
        { buttons: 'view' },
      );
      expect(row).toBeUndefined();

      process.env.CLIENT_URL = origEnv;
    });

    it('should omit row with "none" button mode', () => {
      const { row } = factory.buildEventEmbed(baseEvent, baseContext, {
        buttons: 'none',
      });
      expect(row).toBeUndefined();
    });

    it('should accept a custom action row', () => {
      const customRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('custom:1')
          .setLabel('Custom Button')
          .setStyle(ButtonStyle.Primary),
      );

      const { row } = factory.buildEventEmbed(baseEvent, baseContext, {
        buttons: customRow,
      });

      expect(row).toBeDefined();
      const components = row!.toJSON().components as { label?: string }[];
      expect(components).toHaveLength(1);
      expect(components[0].label).toBe('Custom Button');
    });

    it('should omit buttons for cancelled state regardless of button mode', () => {
      const { row } = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.CANCELLED,
        buttons: 'signup',
      });
      expect(row).toBeUndefined();
    });

    it('should omit buttons for completed state regardless of button mode', () => {
      const { row } = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.COMPLETED,
        buttons: 'signup',
      });
      expect(row).toBeUndefined();
    });
  });

  describe('buildEventEmbed state colors', () => {
    it('should use cyan for posted state', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.POSTED,
      });
      expect(embed.toJSON().color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should use amber for imminent state', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.IMMINENT,
      });
      expect(embed.toJSON().color).toBe(EMBED_COLORS.REMINDER);
    });

    it('should use emerald for live state', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.LIVE,
      });
      expect(embed.toJSON().color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
    });

    it('should use slate for completed state', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.COMPLETED,
      });
      expect(embed.toJSON().color).toBe(EMBED_COLORS.SYSTEM);
    });

    it('should use red for cancelled state', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.CANCELLED,
      });
      expect(embed.toJSON().color).toBe(EMBED_COLORS.ERROR);
    });
  });

  describe('buildEventCancelled', () => {
    it('should use red accent color', () => {
      const { embed } = factory.buildEventCancelled(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.color).toBe(EMBED_COLORS.ERROR);
    });

    it('should strikethrough the title', () => {
      const { embed } = factory.buildEventCancelled(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.title).toContain('~~Mythic Raid Night~~');
      expect(json.title).toContain('CANCELLED');
    });

    it('should indicate cancellation in description', () => {
      const { embed } = factory.buildEventCancelled(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('cancelled');
    });
  });

  describe('deprecated aliases', () => {
    it('buildEventAnnouncement delegates to buildEventEmbed', () => {
      const announcement = factory.buildEventAnnouncement(
        baseEvent,
        baseContext,
      );
      const embed = factory.buildEventEmbed(baseEvent, baseContext);

      const announcementJson = {
        ...announcement.embed.toJSON(),
        timestamp: null,
      };
      const embedJson = { ...embed.embed.toJSON(), timestamp: null };
      expect(announcementJson).toEqual(embedJson);
    });

    it('buildEventUpdate delegates to buildEventEmbed', () => {
      const update = factory.buildEventUpdate(
        baseEvent,
        baseContext,
        EMBED_STATES.IMMINENT,
      );
      const embed = factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.IMMINENT,
      });

      const updateJson = { ...update.embed.toJSON(), timestamp: null };
      const embedJson = { ...embed.embed.toJSON(), timestamp: null };
      expect(updateJson).toEqual(embedJson);
    });
  });

  describe('duration formatting', () => {
    it('should format hours-only duration', () => {
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      expect(embed.toJSON().description).toContain('3h');
    });

    it('should format hours and minutes duration', () => {
      const mixedEvent: EmbedEventData = {
        ...baseEvent,
        endTime: '2026-02-20T21:30:00.000Z', // 1h 30m
      };

      const { embed } = factory.buildEventEmbed(mixedEvent, baseContext);
      expect(embed.toJSON().description).toContain('1h 30m');
    });

    it('should format minutes-only duration', () => {
      const shortEvent: EmbedEventData = {
        ...baseEvent,
        endTime: '2026-02-20T20:45:00.000Z', // 45m
      };

      const { embed } = factory.buildEventEmbed(shortEvent, baseContext);
      expect(embed.toJSON().description).toContain('45m');
    });
  });

  describe('buildEventInvite', () => {
    it('should use teal PUG invite color', () => {
      const { embed } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      expect(embed.toJSON().color).toBe(EMBED_COLORS.PUG_INVITE);
    });

    it('should set the title with invite text', () => {
      const { embed } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      expect(embed.toJSON().title).toBe(
        "You're invited to **Mythic Raid Night**!",
      );
    });

    it('should include game name in description', () => {
      const { embed } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      expect(embed.toJSON().description).toContain('World of Warcraft');
    });

    it('should include Discord native timestamp', () => {
      const { embed } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      const desc = embed.toJSON().description;
      expect(desc).toContain('📆');
      expect(desc).toContain('<t:1771617600:f>');
      expect(desc).toContain('<t:1771617600:R>');
    });

    it('should include description excerpt', () => {
      const eventWithDesc: EmbedEventData = {
        ...baseEvent,
        description: 'Weekly mythic progression',
      };
      const { embed } = factory.buildEventInvite(
        eventWithDesc,
        baseContext,
        'inviter',
      );
      expect(embed.toJSON().description).toContain('Weekly mythic progression');
    });

    it('should truncate long descriptions to 200 chars', () => {
      const longDesc = 'A'.repeat(250);
      const eventWithLongDesc: EmbedEventData = {
        ...baseEvent,
        description: longDesc,
      };
      const { embed } = factory.buildEventInvite(
        eventWithLongDesc,
        baseContext,
        'inviter',
      );
      expect(embed.toJSON().description).toContain('...');
    });

    it('should include inviter and community in footer', () => {
      const { embed } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      const footer = embed.toJSON().footer?.text;
      expect(footer).toContain('inviter');
      expect(footer).toContain('Test Guild');
    });

    it('should include a View Event link button', () => {
      const { row } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      expect(row).toBeDefined();
      const components = row!.toJSON().components as {
        label?: string;
        url?: string;
      }[];
      expect(components).toHaveLength(1);
      expect(components[0].label).toBe('View Event');
      expect(components[0].url).toBe('http://localhost:5173/events/42');
    });

    it('should omit row when no client URL', () => {
      const origEnv = process.env.CLIENT_URL;
      delete process.env.CLIENT_URL;

      const { row } = factory.buildEventInvite(
        baseEvent,
        { communityName: 'Test', clientUrl: null },
        'inviter',
      );
      expect(row).toBeUndefined();

      process.env.CLIENT_URL = origEnv;
    });
  });

  describe('Discord native timestamps (ROK-431)', () => {
    it('should use Discord timestamp syntax regardless of timezone setting', () => {
      // Discord native timestamps are timezone-agnostic: each viewer sees their own tz
      const estContext: EmbedContext = {
        ...baseContext,
        timezone: 'America/New_York',
      };

      const { embed } = factory.buildEventEmbed(baseEvent, estContext);
      const desc = embed.toJSON().description!;

      // Should use <t:UNIX:f> format, not locale-formatted time
      expect(desc).toContain('<t:1771617600:f>');
      expect(desc).toContain('<t:1771617600:R>');
      expect(desc).not.toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
    });

    it('should produce the same output with or without timezone', () => {
      const withTz: EmbedContext = {
        ...baseContext,
        timezone: 'America/Los_Angeles',
      };
      const withoutTz: EmbedContext = {
        ...baseContext,
        timezone: null,
      };

      const descWithTz = factory
        .buildEventEmbed(baseEvent, withTz)
        .embed.toJSON().description!;
      const descWithoutTz = factory
        .buildEventEmbed(baseEvent, withoutTz)
        .embed.toJSON().description!;

      expect(descWithTz).toBe(descWithoutTz);
    });

    it('should use Discord timestamps in invite embeds', () => {
      const { embed } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      const desc = embed.toJSON().description!;

      expect(desc).toContain('<t:1771617600:f>');
      expect(desc).toContain('<t:1771617600:R>');
    });
  });

  describe('role preference badges (ROK-470)', () => {
    it('should show role emoji badges next to player mentions in MMO roster', () => {
      const eventWithMentions: EmbedEventData = {
        ...baseEvent,
        signupCount: 3,
        roleCounts: { tank: 1, healer: 1, dps: 1 },
        signupMentions: [
          {
            discordId: '111',
            username: 'TankPlayer',
            role: 'tank',
            preferredRoles: ['tank', 'dps'],
            status: 'signed_up',
          },
          {
            discordId: '222',
            username: 'HealerPlayer',
            role: 'healer',
            preferredRoles: ['healer'],
            status: 'signed_up',
          },
          {
            discordId: '333',
            username: 'DpsPlayer',
            role: 'dps',
            preferredRoles: ['tank', 'healer', 'dps'],
            status: 'signed_up',
          },
        ],
      };

      const { embed } = factory.buildEventEmbed(eventWithMentions, baseContext);
      const desc = embed.toJSON().description!;

      // Tank player: name then role emojis after
      expect(desc).toContain('\u2003<@111> \u{1F6E1}\uFE0F\u2694\uFE0F');
      // Healer player: name then healer emoji after
      expect(desc).toContain('\u2003<@222> \u{1F49A}');
      // DPS player: name then all three role emojis after
      expect(desc).toContain(
        '\u2003<@333> \u{1F6E1}\uFE0F\u{1F49A}\u2694\uFE0F',
      );
    });

    it('should show just @mention when player has no preferred roles and no assigned role', () => {
      const eventWithNoPrefs: EmbedEventData = {
        ...baseEvent,
        slotConfig: null,
        maxAttendees: 10,
        signupCount: 1,
        signupMentions: [
          {
            discordId: '444',
            username: 'NoRolePlayer',
            role: null,
            preferredRoles: null,
            status: 'signed_up',
          },
        ],
      };

      const { embed } = factory.buildEventEmbed(eventWithNoPrefs, baseContext);
      const desc = embed.toJSON().description!;

      // Should show the mention without any role emojis
      expect(desc).toContain('<@444>');
      // But no role emoji right after the mention
      expect(desc).not.toMatch(/<@444>[\u{1F6E1}\u{1F49A}\u2694]/u);
    });

    it('should fall back to assigned role emoji when preferredRoles is empty', () => {
      const eventWithAssignedOnly: EmbedEventData = {
        ...baseEvent,
        signupCount: 1,
        roleCounts: { tank: 1 },
        signupMentions: [
          {
            discordId: '555',
            username: 'AssignedTank',
            role: 'tank',
            preferredRoles: [],
            status: 'signed_up',
          },
        ],
      };

      const { embed } = factory.buildEventEmbed(
        eventWithAssignedOnly,
        baseContext,
      );
      const desc = embed.toJSON().description!;

      // Should fall back to showing assigned role emoji after name
      expect(desc).toContain('\u2003<@555> \u{1F6E1}\uFE0F');
    });

    it('should combine tentative prefix with role badges', () => {
      const eventWithTentative: EmbedEventData = {
        ...baseEvent,
        signupCount: 1,
        roleCounts: { healer: 1 },
        signupMentions: [
          {
            discordId: '666',
            username: 'TentativeHealer',
            role: 'healer',
            preferredRoles: ['healer', 'dps'],
            status: 'tentative',
          },
        ],
      };

      const { embed } = factory.buildEventEmbed(
        eventWithTentative,
        baseContext,
      );
      const desc = embed.toJSON().description!;

      // Should show tentative prefix (⏳) then mention then role emojis after
      // Note: double space between ⏳ and name because tentativePrefix includes trailing space
      expect(desc).toContain('\u2003\u23F3  <@666> \u{1F49A}\u2694\uFE0F');
    });

    it('should show username with role badges when no discordId', () => {
      const eventWithUsername: EmbedEventData = {
        ...baseEvent,
        signupCount: 1,
        roleCounts: { dps: 1 },
        signupMentions: [
          {
            discordId: null,
            username: 'WebOnlyUser',
            role: 'dps',
            preferredRoles: ['dps'],
            status: 'signed_up',
          },
        ],
      };

      const { embed } = factory.buildEventEmbed(eventWithUsername, baseContext);
      const desc = embed.toJSON().description!;

      // Should use username instead of @mention, role emoji after name
      expect(desc).toContain('\u2003WebOnlyUser \u2694\uFE0F');
    });

    it('should show role badges in non-MMO roster with maxAttendees', () => {
      const simpleEventWithMentions: EmbedEventData = {
        ...baseEvent,
        slotConfig: null,
        maxAttendees: 5,
        signupCount: 2,
        signupMentions: [
          {
            discordId: '777',
            username: 'Player1',
            role: null,
            preferredRoles: ['tank', 'healer'],
            status: 'signed_up',
          },
          {
            discordId: '888',
            username: 'Player2',
            role: null,
            preferredRoles: null,
            status: 'signed_up',
          },
        ],
      };

      const { embed } = factory.buildEventEmbed(
        simpleEventWithMentions,
        baseContext,
      );
      const desc = embed.toJSON().description!;

      // Player with role prefs should show emoji after name
      expect(desc).toContain('\u2003<@777> \u{1F6E1}\uFE0F\u{1F49A}');
      // Player without prefs should show just mention
      expect(desc).toContain('<@888>');
      expect(desc).not.toMatch(/<@888>[\u{1F6E1}\u{1F49A}\u2694]/u);
    });
  });
});
