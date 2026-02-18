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
      expect(json.description).toContain('Tanks:');
      expect(json.description).toContain('Healers:');
      expect(json.description).toContain('DPS:');
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

    it('should include a View Event URL button', () => {
      const { row } = factory.buildEventAnnouncement(baseEvent, baseContext);

      expect(row).toBeDefined();
      const components = row!.toJSON().components;
      expect(components).toHaveLength(1);
      const button = components[0] as { label?: string; url?: string };
      expect(button.label).toBe('View Event');
      expect(button.url).toBe('http://localhost:5173/events/42');
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

    it('should omit View Event button when no client URL', () => {
      const noUrlContext: EmbedContext = {
        communityName: 'Test',
        clientUrl: null,
      };
      const origEnv = process.env.CLIENT_URL;
      delete process.env.CLIENT_URL;

      const { row } = factory.buildEventAnnouncement(baseEvent, noUrlContext);

      expect(row).toBeUndefined();

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
});
