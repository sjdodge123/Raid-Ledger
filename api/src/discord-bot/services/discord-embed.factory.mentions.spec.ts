/**
 * Adversarial tests for DiscordEmbedFactory.getMentionsForRole — ROK-373
 * Covers the mention list cap at 25 with "+ N more" suffix.
 */
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';

type SignupMention = {
  discordId?: string | null;
  username?: string | null;
  role: string | null;
  preferredRoles: string[] | null;
  status?: string | null;
};

function makeMention(
  index: number,
  role: string | null = 'dps',
): SignupMention {
  return {
    discordId: `discord-user-${index}`,
    username: `user-${index}`,
    role,
    preferredRoles: role ? [role] : null,
    status: 'signed_up',
  };
}

/**
 * Helper to extract the roster/mention text from a built embed's description.
 * We build a full embed and inspect the description which contains the mention text.
 */
function buildEventWithMentions(
  mentions: SignupMention[],
  role: string = 'dps',
): string {
  const factory = new DiscordEmbedFactory();
  const slotConfig =
    role === 'dps' || role === 'tank' || role === 'healer'
      ? { type: 'mmo', tank: 2, healer: 4, dps: 30 }
      : null;

  const event: EmbedEventData = {
    id: 1,
    title: 'Test Event',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: mentions.length,
    maxAttendees: null,
    slotConfig,
    roleCounts: { [role]: mentions.length },
    signupMentions: mentions,
  };

  const context: EmbedContext = {
    communityName: 'Test Guild',
    clientUrl: 'http://localhost:5173',
  };

  const { embed } = factory.buildEventEmbed(event, context);
  return embed.toJSON().description ?? '';
}

/**
 * Helper for non-role embeds that use getMentionsForRole(mentions, null).
 */
function buildEventWithAllMentions(mentions: SignupMention[]): string {
  const factory = new DiscordEmbedFactory();

  const event: EmbedEventData = {
    id: 1,
    title: 'Test Event',
    startTime: '2026-02-20T20:00:00.000Z',
    endTime: '2026-02-20T23:00:00.000Z',
    signupCount: mentions.length,
    maxAttendees: 50,
    slotConfig: null,
    roleCounts: null,
    signupMentions: mentions,
  };

  const context: EmbedContext = {
    communityName: 'Test Guild',
    clientUrl: 'http://localhost:5173',
  };

  const { embed } = factory.buildEventEmbed(event, context);
  return embed.toJSON().description ?? '';
}

describe('DiscordEmbedFactory — getMentionsForRole mention list cap (ROK-373)', () => {
  describe('fewer than 25 mentions — no truncation', () => {
    it('should list all mentions when count is 1', () => {
      const mentions = [makeMention(0, 'dps')];
      const description = buildEventWithMentions(mentions, 'dps');
      expect(description).toContain('<@discord-user-0>');
      expect(description).not.toContain('more');
    });

    it('should list all mentions when count is 10', () => {
      const mentions = Array.from({ length: 10 }, (_, i) =>
        makeMention(i, 'dps'),
      );
      const description = buildEventWithMentions(mentions, 'dps');
      for (let i = 0; i < 10; i++) {
        expect(description).toContain(`<@discord-user-${i}>`);
      }
      expect(description).not.toContain('more');
    });

    it('should list all mentions when count is 24', () => {
      const mentions = Array.from({ length: 24 }, (_, i) =>
        makeMention(i, 'dps'),
      );
      const description = buildEventWithMentions(mentions, 'dps');
      for (let i = 0; i < 24; i++) {
        expect(description).toContain(`<@discord-user-${i}>`);
      }
      expect(description).not.toContain('more');
    });
  });

  describe('exactly 25 mentions — boundary at cap', () => {
    it('should list all 25 mentions with no overflow suffix at exactly 25', () => {
      const mentions = Array.from({ length: 25 }, (_, i) =>
        makeMention(i, 'dps'),
      );
      const description = buildEventWithMentions(mentions, 'dps');
      for (let i = 0; i < 25; i++) {
        expect(description).toContain(`<@discord-user-${i}>`);
      }
      // Overflow = 25 - 25 = 0, so "+ N more" should NOT appear
      expect(description).not.toContain('more');
    });
  });

  describe('more than 25 mentions — truncation with suffix', () => {
    it('should cap at 25 and append "+ 1 more" when 26 mentions', () => {
      const mentions = Array.from({ length: 26 }, (_, i) =>
        makeMention(i, 'dps'),
      );
      const description = buildEventWithMentions(mentions, 'dps');
      // First 25 should appear
      for (let i = 0; i < 25; i++) {
        expect(description).toContain(`<@discord-user-${i}>`);
      }
      // 26th mention (index 25) must NOT appear as a mention
      expect(description).not.toContain('<@discord-user-25>');
      // Overflow suffix
      expect(description).toContain('+ 1 more');
    });

    it('should cap at 25 and append "+ 5 more" when 30 mentions', () => {
      const mentions = Array.from({ length: 30 }, (_, i) =>
        makeMention(i, 'dps'),
      );
      const description = buildEventWithMentions(mentions, 'dps');
      for (let i = 0; i < 25; i++) {
        expect(description).toContain(`<@discord-user-${i}>`);
      }
      // Mentions 25-29 must not appear as Discord mentions
      for (let i = 25; i < 30; i++) {
        expect(description).not.toContain(`<@discord-user-${i}>`);
      }
      expect(description).toContain('+ 5 more');
    });

    it('should cap at 25 and append "+ 75 more" when 100 mentions', () => {
      const mentions = Array.from({ length: 100 }, (_, i) =>
        makeMention(i, 'tank'),
      );
      const description = buildEventWithMentions(mentions, 'tank');
      // Overflow = 100 - 25 = 75
      expect(description).toContain('+ 75 more');
    });

    it('suffix format is exactly "+ N more" (space before and after N)', () => {
      const mentions = Array.from({ length: 27 }, (_, i) =>
        makeMention(i, 'healer'),
      );
      const description = buildEventWithMentions(mentions, 'healer');
      // Overflow = 2
      expect(description).toMatch(/\+ 2 more/);
    });
  });

  describe('getMentionsForRole with role=null (all mentions)', () => {
    it('should show "+ 2 more" when 27 total mentions with no role filter', () => {
      const mentions = Array.from({ length: 27 }, (_, i) => ({
        ...makeMention(i, null),
        role: null,
        preferredRoles: null,
      }));
      const description = buildEventWithAllMentions(mentions);
      expect(description).toContain('+ 2 more');
    });

    it('should list all 25 with no suffix when exactly 25 total mentions (role=null)', () => {
      const mentions = Array.from({ length: 25 }, (_, i) => ({
        ...makeMention(i, null),
        role: null,
        preferredRoles: null,
      }));
      const description = buildEventWithAllMentions(mentions);
      expect(description).not.toContain('more');
    });
  });

  describe('username fallback when no discordId', () => {
    it('should use username as label when discordId is null', () => {
      const mention: SignupMention = {
        discordId: null,
        username: 'anonymous-user',
        role: 'dps',
        preferredRoles: ['dps'],
        status: 'signed_up',
      };
      const description = buildEventWithMentions([mention], 'dps');
      expect(description).toContain('anonymous-user');
      expect(description).not.toContain('<@null>');
    });

    it('should use "???" when both discordId and username are null', () => {
      const mention: SignupMention = {
        discordId: null,
        username: null,
        role: 'dps',
        preferredRoles: ['dps'],
        status: 'signed_up',
      };
      const description = buildEventWithMentions([mention], 'dps');
      expect(description).toContain('???');
    });
  });

  describe('tentative prefix', () => {
    it('should prefix tentative players with ⏳', () => {
      const mention: SignupMention = {
        discordId: 'discord-tent-1',
        username: 'tentative-user',
        role: 'dps',
        preferredRoles: ['dps'],
        status: 'tentative',
      };
      const description = buildEventWithMentions([mention], 'dps');
      expect(description).toContain('⏳');
      expect(description).toContain('<@discord-tent-1>');
    });

    it('should NOT prefix non-tentative players with ⏳', () => {
      const mention: SignupMention = {
        discordId: 'discord-signed-1',
        username: 'signed-user',
        role: 'dps',
        preferredRoles: ['dps'],
        status: 'signed_up',
      };
      const description = buildEventWithMentions([mention], 'dps');
      expect(description).not.toContain('⏳');
    });
  });

  describe('role emoji display', () => {
    it('should show role emojis for preferred roles', () => {
      const mention: SignupMention = {
        discordId: 'discord-flex-1',
        username: 'flex-user',
        role: 'tank',
        preferredRoles: ['tank', 'healer'],
        status: 'signed_up',
      };
      const description = buildEventWithMentions([mention], 'tank');
      // Should show tank emoji (🛡️) and healer emoji (💚)
      expect(description).toContain('🛡️');
      expect(description).toContain('💚');
    });
  });
});
