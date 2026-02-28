/**
 * Voice channel embed tests for ROK-507.
 * Tests that voice channel IDs are correctly rendered in event embeds and invite embeds.
 */
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';

describe('DiscordEmbedFactory — voice channel display (ROK-507)', () => {
  let factory: DiscordEmbedFactory;

  const baseEvent: EmbedEventData = {
    id: 42,
    title: 'Mythic Raid Night',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: 0,
    game: {
      name: 'World of Warcraft',
      coverUrl: null,
    },
  };

  const baseContext: EmbedContext = {
    communityName: 'Test Guild',
    clientUrl: 'http://localhost:5173',
  };

  beforeEach(() => {
    const emojiService = {
      getRoleEmoji: jest.fn(() => ''),
      getClassEmoji: jest.fn(() => ''),
      isUsingCustomEmojis: jest.fn(() => false),
    } as unknown as DiscordEmojiService;
    factory = new DiscordEmbedFactory(emojiService);
  });

  // ─── createBaseEmbed (buildEventEmbed) ───────────────────────────────────

  describe('buildEventEmbed — voice channel in base embed', () => {
    it('includes voice channel link when voiceChannelId is set', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: '111222333444555666',
      };

      const { embed } = factory.buildEventEmbed(event, baseContext);
      const desc = embed.toJSON().description!;

      expect(desc).toContain('🔊 <#111222333444555666>');
    });

    it('omits voice channel line when voiceChannelId is null', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: null,
      };

      const { embed } = factory.buildEventEmbed(event, baseContext);
      const desc = embed.toJSON().description!;

      expect(desc).not.toContain('🔊');
    });

    it('omits voice channel line when voiceChannelId is undefined', () => {
      // baseEvent has no voiceChannelId at all
      const { embed } = factory.buildEventEmbed(baseEvent, baseContext);
      const desc = embed.toJSON().description!;

      expect(desc).not.toContain('🔊');
    });

    it('renders voice channel as Discord clickable channel mention (<#id>)', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: '999888777666555444',
      };

      const { embed } = factory.buildEventEmbed(event, baseContext);
      const desc = embed.toJSON().description!;

      // Must be exactly <#channelId> format — not a URL, not just the ID
      expect(desc).toMatch(/<#999888777666555444>/);
    });

    it('places voice channel line between timestamp and roster section', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: '123',
        signupCount: 2,
        maxAttendees: 10,
        signupMentions: null,
      };

      const { embed } = factory.buildEventEmbed(event, baseContext);
      const desc = embed.toJSON().description!;

      // Timestamp (📆) must come before voice channel (🔊)
      const tsPos = desc.indexOf('📆');
      const vcPos = desc.indexOf('🔊');
      const rosterPos = desc.indexOf('ROSTER');

      expect(tsPos).toBeLessThan(vcPos);
      expect(vcPos).toBeLessThan(rosterPos);
    });

    it('voice channel appears even when there is no game configured', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        game: null,
        voiceChannelId: '555',
      };

      const { embed } = factory.buildEventEmbed(event, baseContext);
      const desc = embed.toJSON().description!;

      expect(desc).toContain('🔊 <#555>');
      expect(desc).not.toContain('🎮');
    });
  });

  // ─── buildEventInvite ────────────────────────────────────────────────────

  describe('buildEventInvite — voice channel in invite DM embed', () => {
    it('includes voice channel link when voiceChannelId is set', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: '777666555444333222',
      };

      const { embed } = factory.buildEventInvite(event, baseContext, 'Alice');
      const desc = embed.toJSON().description!;

      expect(desc).toContain('🔊 <#777666555444333222>');
    });

    it('omits voice channel line when voiceChannelId is null', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: null,
      };

      const { embed } = factory.buildEventInvite(event, baseContext, 'Bob');
      const desc = embed.toJSON().description!;

      expect(desc).not.toContain('🔊');
    });

    it('omits voice channel line when voiceChannelId is not set', () => {
      const { embed } = factory.buildEventInvite(baseEvent, baseContext, 'Bob');
      const desc = embed.toJSON().description!;

      expect(desc).not.toContain('🔊');
    });

    it('places voice channel after timestamp but before description excerpt', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        description: 'This is a long event description',
        voiceChannelId: '123456',
      };

      const { embed } = factory.buildEventInvite(event, baseContext, 'Carol');
      const desc = embed.toJSON().description!;

      const tsPos = desc.indexOf('📆');
      const vcPos = desc.indexOf('🔊');
      const excerptPos = desc.indexOf('This is a long event description');

      expect(tsPos).toBeLessThan(vcPos);
      expect(vcPos).toBeLessThan(excerptPos);
    });

    it('renders voice channel as correct Discord channel mention format', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: '112233445566778899',
      };

      const { embed } = factory.buildEventInvite(event, baseContext, 'Dave');
      const desc = embed.toJSON().description!;

      expect(desc).toMatch(/<#112233445566778899>/);
    });

    it('voice channel works alongside game name in invite embed', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        game: { name: 'World of Warcraft', coverUrl: null },
        voiceChannelId: '999',
      };

      const { embed } = factory.buildEventInvite(event, baseContext, 'Eve');
      const desc = embed.toJSON().description!;

      expect(desc).toContain('🎮 **World of Warcraft**');
      expect(desc).toContain('🔊 <#999>');
    });
  });

  // ─── EmbedEventData interface (structural) ───────────────────────────────

  describe('EmbedEventData.voiceChannelId interface', () => {
    it('accepts a string voiceChannelId without type errors', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: '123456789',
      };

      expect(() => factory.buildEventEmbed(event, baseContext)).not.toThrow();
    });

    it('accepts null voiceChannelId without type errors', () => {
      const event: EmbedEventData = {
        ...baseEvent,
        voiceChannelId: null,
      };

      expect(() => factory.buildEventEmbed(event, baseContext)).not.toThrow();
    });

    it('accepts undefined (omitted) voiceChannelId without type errors', () => {
      // voiceChannelId omitted — should compile and run fine
      const { id, title, startTime, endTime, signupCount } = baseEvent;
      const event: EmbedEventData = {
        id,
        title,
        startTime,
        endTime,
        signupCount,
      };

      expect(() => factory.buildEventEmbed(event, baseContext)).not.toThrow();
    });
  });
});
