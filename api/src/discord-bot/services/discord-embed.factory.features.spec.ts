/**
 * DiscordEmbedFactory — duration formatting, buildEventInvite,
 * Discord native timestamps, and role preference badges tests.
 */
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';

const UNICODE_FALLBACK: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

const baseEvent: EmbedEventData = {
  id: 42, title: 'Mythic Raid Night', description: 'Weekly mythic progression',
  startTime: '2026-02-20T20:00:00.000Z', endTime: '2026-02-20T23:00:00.000Z',
  signupCount: 15, maxAttendees: 20,
  slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
  game: { name: 'World of Warcraft', coverUrl: 'https://example.com/wow-art.jpg' },
};

const baseContext: EmbedContext = { communityName: 'Test Guild', clientUrl: 'http://localhost:5173' };

describe('DiscordEmbedFactory — features', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    const emojiService = {
      getRoleEmoji: jest.fn((role: string) => UNICODE_FALLBACK[role] ?? ''),
      isUsingCustomEmojis: jest.fn(() => false),
    } as unknown as DiscordEmojiService;
    factory = new DiscordEmbedFactory(emojiService);
  });

  describe('duration formatting', () => {
    it('should format hours-only duration', () => {
      expect(factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON().description).toContain('3h');
    });

    it('should format hours and minutes duration', () => {
      expect(factory.buildEventEmbed({ ...baseEvent, endTime: '2026-02-20T21:30:00.000Z' }, baseContext).embed.toJSON().description).toContain('1h 30m');
    });

    it('should format minutes-only duration', () => {
      expect(factory.buildEventEmbed({ ...baseEvent, endTime: '2026-02-20T20:45:00.000Z' }, baseContext).embed.toJSON().description).toContain('45m');
    });
  });

  describe('buildEventInvite', () => {
    it('should use teal PUG invite color', () => {
      const { EMBED_COLORS } = require('../discord-bot.constants');
      expect(factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON().color).toBe(EMBED_COLORS.PUG_INVITE);
    });

    it('should set the title with invite text', () => {
      expect(factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON().title).toBe("You're invited to **Mythic Raid Night**!");
    });

    it('should include game name in description', () => {
      expect(factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON().description).toContain('World of Warcraft');
    });

    it('should include Discord native timestamp', () => {
      const desc = factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON().description;
      expect(desc).toContain('\uD83D\uDCC6');
      expect(desc).toContain('<t:1771617600:f>');
      expect(desc).toContain('<t:1771617600:R>');
    });

    it('should include description excerpt', () => {
      expect(factory.buildEventInvite({ ...baseEvent, description: 'Weekly mythic progression' }, baseContext, 'inviter').embed.toJSON().description).toContain('Weekly mythic progression');
    });

    it('should truncate long descriptions to 200 chars', () => {
      const longDesc = 'A'.repeat(250);
      expect(factory.buildEventInvite({ ...baseEvent, description: longDesc }, baseContext, 'inviter').embed.toJSON().description).toContain('...');
    });

    it('should include inviter and community in footer', () => {
      const footer = factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON().footer?.text;
      expect(footer).toContain('inviter');
      expect(footer).toContain('Test Guild');
    });

    it('should include a View Event link button', () => {
      const { row } = factory.buildEventInvite(baseEvent, baseContext, 'inviter');
      const components = row!.toJSON().components as { label?: string; url?: string }[];
      expect(components).toHaveLength(1);
      expect(components[0].label).toBe('View Event');
      expect(components[0].url).toBe('http://localhost:5173/events/42');
    });

    it('should omit row when no client URL', () => {
      const origEnv = process.env.CLIENT_URL;
      delete process.env.CLIENT_URL;
      expect(factory.buildEventInvite(baseEvent, { communityName: 'Test', clientUrl: null }, 'inviter').row).toBeUndefined();
      process.env.CLIENT_URL = origEnv;
    });
  });

  describe('Discord native timestamps (ROK-431)', () => {
    it('should use Discord timestamp syntax regardless of timezone setting', () => {
      const desc = factory.buildEventEmbed(baseEvent, { ...baseContext, timezone: 'America/New_York' }).embed.toJSON().description!;
      expect(desc).toContain('<t:1771617600:f>');
      expect(desc).toContain('<t:1771617600:R>');
      expect(desc).not.toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
    });

    it('should produce the same output with or without timezone', () => {
      const descWithTz = factory.buildEventEmbed(baseEvent, { ...baseContext, timezone: 'America/Los_Angeles' }).embed.toJSON().description!;
      const descWithoutTz = factory.buildEventEmbed(baseEvent, { ...baseContext, timezone: null }).embed.toJSON().description!;
      expect(descWithTz).toBe(descWithoutTz);
    });

    it('should use Discord timestamps in invite embeds', () => {
      const desc = factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON().description!;
      expect(desc).toContain('<t:1771617600:f>');
      expect(desc).toContain('<t:1771617600:R>');
    });
  });

  describe('role preference badges (ROK-470)', () => {
    it('should show role emoji badges next to player mentions in MMO roster', () => {
      const eventWithMentions: EmbedEventData = {
        ...baseEvent, signupCount: 3, roleCounts: { tank: 1, healer: 1, dps: 1 },
        signupMentions: [
          { discordId: '111', username: 'TankPlayer', role: 'tank', preferredRoles: ['tank', 'dps'], status: 'signed_up' },
          { discordId: '222', username: 'HealerPlayer', role: 'healer', preferredRoles: ['healer'], status: 'signed_up' },
          { discordId: '333', username: 'DpsPlayer', role: 'dps', preferredRoles: ['tank', 'healer', 'dps'], status: 'signed_up' },
        ],
      };
      const desc = factory.buildEventEmbed(eventWithMentions, baseContext).embed.toJSON().description!;
      expect(desc).toContain('\u2003<@111> \u{1F6E1}\uFE0F\u2694\uFE0F');
      expect(desc).toContain('\u2003<@222> \u{1F49A}');
      expect(desc).toContain('\u2003<@333> \u{1F6E1}\uFE0F\u{1F49A}\u2694\uFE0F');
    });

    it('should show just @mention when player has no preferred roles and no assigned role', () => {
      const eventWithNoPrefs: EmbedEventData = {
        ...baseEvent, slotConfig: null, maxAttendees: 10, signupCount: 1,
        signupMentions: [{ discordId: '444', username: 'NoRolePlayer', role: null, preferredRoles: null, status: 'signed_up' }],
      };
      const desc = factory.buildEventEmbed(eventWithNoPrefs, baseContext).embed.toJSON().description!;
      expect(desc).toContain('<@444>');
      expect(desc).not.toMatch(/<@444>[\u{1F6E1}\u{1F49A}\u2694]/u);
    });

    it('should fall back to assigned role emoji when preferredRoles is empty', () => {
      const eventWithAssignedOnly: EmbedEventData = {
        ...baseEvent, signupCount: 1, roleCounts: { tank: 1 },
        signupMentions: [{ discordId: '555', username: 'AssignedTank', role: 'tank', preferredRoles: [], status: 'signed_up' }],
      };
      const desc = factory.buildEventEmbed(eventWithAssignedOnly, baseContext).embed.toJSON().description!;
      expect(desc).toContain('\u2003<@555> \u{1F6E1}\uFE0F');
    });

    it('should combine tentative prefix with role badges', () => {
      const eventWithTentative: EmbedEventData = {
        ...baseEvent, signupCount: 1, roleCounts: { healer: 1 },
        signupMentions: [{ discordId: '666', username: 'TentativeHealer', role: 'healer', preferredRoles: ['healer', 'dps'], status: 'tentative' }],
      };
      const desc = factory.buildEventEmbed(eventWithTentative, baseContext).embed.toJSON().description!;
      expect(desc).toContain('\u2003\u23F3  <@666> \u{1F49A}\u2694\uFE0F');
    });

    it('should show username with role badges when no discordId', () => {
      const eventWithUsername: EmbedEventData = {
        ...baseEvent, signupCount: 1, roleCounts: { dps: 1 },
        signupMentions: [{ discordId: null, username: 'WebOnlyUser', role: 'dps', preferredRoles: ['dps'], status: 'signed_up' }],
      };
      const desc = factory.buildEventEmbed(eventWithUsername, baseContext).embed.toJSON().description!;
      expect(desc).toContain('\u2003WebOnlyUser \u2694\uFE0F');
    });

    it('should show role badges in non-MMO roster with maxAttendees', () => {
      const simpleEventWithMentions: EmbedEventData = {
        ...baseEvent, slotConfig: null, maxAttendees: 5, signupCount: 2,
        signupMentions: [
          { discordId: '777', username: 'Player1', role: null, preferredRoles: ['tank', 'healer'], status: 'signed_up' },
          { discordId: '888', username: 'Player2', role: null, preferredRoles: null, status: 'signed_up' },
        ],
      };
      const desc = factory.buildEventEmbed(simpleEventWithMentions, baseContext).embed.toJSON().description!;
      expect(desc).toContain('\u2003<@777> \u{1F6E1}\uFE0F\u{1F49A}');
      expect(desc).toContain('<@888>');
      expect(desc).not.toMatch(/<@888>[\u{1F6E1}\u{1F49A}\u2694]/u);
    });
  });
});
