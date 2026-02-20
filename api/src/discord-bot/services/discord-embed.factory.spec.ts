import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { EMBED_COLORS, EMBED_STATES } from '../discord-bot.constants';

describe('DiscordEmbedFactory', () => {
  let factory: DiscordEmbedFactory;

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
    factory = new DiscordEmbedFactory();
  });

  describe('buildEventAnnouncement', () => {
    it('should build an embed with cyan color for new events', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should set the title with calendar emoji prefix', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.title).toBe('📅 Mythic Raid Night');
    });

    it('should set the author to Raid Ledger', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.author?.name).toBe('Raid Ledger');
    });

    it('should include game name in the description', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('World of Warcraft');
    });

    it('should include date and time in the description', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      // Date format is locale-dependent but should include a date marker
      expect(json.description).toContain('📆');
      expect(json.description).toContain('⏰');
    });

    it('should include duration in the description', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('3h');
    });

    it('should include roster breakdown for MMO slot config', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.description).toContain('ROSTER:');
      expect(json.description).toContain('Tanks (');
      expect(json.description).toContain('Healers (');
      expect(json.description).toContain('DPS (');
    });

    it('should set game art as thumbnail', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.thumbnail?.url).toBe('https://example.com/wow-art.jpg');
    });

    it('should include community name in footer', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      const json = embed.toJSON();

      expect(json.footer?.text).toContain('Test Guild');
      expect(json.footer?.text).toContain('View in Raid Ledger');
    });

    it('should include signup action buttons and a View Event link button', () => {
      const { row } = factory.buildEventAnnouncement(baseEvent, baseContext);

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

      const { embed } = factory.buildEventAnnouncement(
        noGameEvent,
        baseContext,
      );
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

      const { embed } = factory.buildEventAnnouncement(
        simpleEvent,
        baseContext,
      );
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

      const { embed } = factory.buildEventAnnouncement(openEvent, baseContext);
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

      const { embed } = factory.buildEventAnnouncement(emptyEvent, baseContext);
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

      const { row } = factory.buildEventAnnouncement(baseEvent, noUrlContext);

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

      const { embed } = factory.buildEventAnnouncement(
        baseEvent,
        noNameContext,
      );
      const json = embed.toJSON();

      expect(json.footer?.text).toContain('Community');
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

  describe('buildEventUpdate', () => {
    it('should use cyan for posted state', () => {
      const { embed } = factory.buildEventUpdate(
        baseEvent,
        baseContext,
        EMBED_STATES.POSTED,
      );
      expect(embed.toJSON().color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should use amber for imminent state', () => {
      const { embed } = factory.buildEventUpdate(
        baseEvent,
        baseContext,
        EMBED_STATES.IMMINENT,
      );
      expect(embed.toJSON().color).toBe(EMBED_COLORS.REMINDER);
    });

    it('should use emerald for live state', () => {
      const { embed } = factory.buildEventUpdate(
        baseEvent,
        baseContext,
        EMBED_STATES.LIVE,
      );
      expect(embed.toJSON().color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
    });

    it('should use slate for completed state', () => {
      const { embed } = factory.buildEventUpdate(
        baseEvent,
        baseContext,
        EMBED_STATES.COMPLETED,
      );
      expect(embed.toJSON().color).toBe(EMBED_COLORS.SYSTEM);
    });

    it('should use red for cancelled state', () => {
      const { embed } = factory.buildEventUpdate(
        baseEvent,
        baseContext,
        EMBED_STATES.CANCELLED,
      );
      expect(embed.toJSON().color).toBe(EMBED_COLORS.ERROR);
    });
  });

  describe('duration formatting', () => {
    it('should format hours-only duration', () => {
      const { embed } = factory.buildEventAnnouncement(baseEvent, baseContext);
      expect(embed.toJSON().description).toContain('3h');
    });

    it('should format hours and minutes duration', () => {
      const mixedEvent: EmbedEventData = {
        ...baseEvent,
        endTime: '2026-02-20T21:30:00.000Z', // 1h 30m
      };

      const { embed } = factory.buildEventAnnouncement(mixedEvent, baseContext);
      expect(embed.toJSON().description).toContain('1h 30m');
    });

    it('should format minutes-only duration', () => {
      const shortEvent: EmbedEventData = {
        ...baseEvent,
        endTime: '2026-02-20T20:45:00.000Z', // 45m
      };

      const { embed } = factory.buildEventAnnouncement(shortEvent, baseContext);
      expect(embed.toJSON().description).toContain('45m');
    });
  });

  describe('buildEventPreview', () => {
    it('should use cyan announcement color', () => {
      const { embed } = factory.buildEventPreview(baseEvent, baseContext);
      expect(embed.toJSON().color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    });

    it('should set the title with calendar emoji', () => {
      const { embed } = factory.buildEventPreview(baseEvent, baseContext);
      expect(embed.toJSON().title).toBe('📅 Mythic Raid Night');
    });

    it('should include game name in description', () => {
      const { embed } = factory.buildEventPreview(baseEvent, baseContext);
      expect(embed.toJSON().description).toContain('World of Warcraft');
    });

    it('should include signup count', () => {
      const { embed } = factory.buildEventPreview(baseEvent, baseContext);
      expect(embed.toJSON().description).toContain('15');
      expect(embed.toJSON().description).toContain('signed up');
    });

    it('should include date and time', () => {
      const { embed } = factory.buildEventPreview(baseEvent, baseContext);
      const desc = embed.toJSON().description;
      expect(desc).toContain('📆');
      expect(desc).toContain('⏰');
    });

    it('should include a View Event link button', () => {
      const { row } = factory.buildEventPreview(baseEvent, baseContext);
      expect(row).toBeDefined();
      const components = row!.toJSON().components as {
        label?: string;
        url?: string;
      }[];
      expect(components).toHaveLength(1);
      expect(components[0].label).toBe('View Event');
      expect(components[0].url).toBe('http://localhost:5173/events/42');
    });

    it('should set game art as thumbnail', () => {
      const { embed } = factory.buildEventPreview(baseEvent, baseContext);
      expect(embed.toJSON().thumbnail?.url).toBe(
        'https://example.com/wow-art.jpg',
      );
    });

    it('should include community name in footer', () => {
      const { embed } = factory.buildEventPreview(baseEvent, baseContext);
      expect(embed.toJSON().footer?.text).toBe('Test Guild');
    });

    it('should omit row when no client URL', () => {
      const origEnv = process.env.CLIENT_URL;
      delete process.env.CLIENT_URL;

      const { row } = factory.buildEventPreview(baseEvent, {
        communityName: 'Test',
        clientUrl: null,
      });
      expect(row).toBeUndefined();

      process.env.CLIENT_URL = origEnv;
    });

    it('should handle events without game data', () => {
      const noGameEvent: EmbedEventData = { ...baseEvent, game: null };
      const { embed } = factory.buildEventPreview(noGameEvent, baseContext);
      expect(embed.toJSON().description).not.toContain('🎮');
      expect(embed.toJSON().thumbnail).toBeUndefined();
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

    it('should include date and time', () => {
      const { embed } = factory.buildEventInvite(
        baseEvent,
        baseContext,
        'inviter',
      );
      const desc = embed.toJSON().description;
      expect(desc).toContain('📆');
      expect(desc).toContain('⏰');
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
});
