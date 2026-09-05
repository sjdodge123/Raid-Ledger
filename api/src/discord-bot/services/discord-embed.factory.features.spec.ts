/**
 * DiscordEmbedFactory — duration formatting, buildEventInvite,
 * Discord native timestamps, and role preference badges tests.
 *
 * ROK-1460: the roster renders `{marks} **Name** {roleEmoji}` instead of the
 * old em-space + `<@id>` line, and the invite DM puts the inviter on the author
 * line with the community alone in the footer. The byte-exact roster pins below
 * are the same strings re-anchored on that grammar — none were dropped.
 */
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import { EMBED_COLORS } from '../discord-bot.constants';

const UNICODE_FALLBACK: Record<string, string> = {
  tank: '\uD83D\uDEE1\uFE0F',
  healer: '\uD83D\uDC9A',
  dps: '\u2694\uFE0F',
};

const baseEvent: EmbedEventData = {
  id: 42,
  title: 'Mythic Raid Night',
  description: 'Weekly mythic progression',
  startTime: '2026-02-20T20:00:00.000Z',
  endTime: '2026-02-20T23:00:00.000Z',
  signupCount: 15,
  maxAttendees: 20,
  slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
  game: {
    name: 'World of Warcraft',
    coverUrl: 'https://example.com/wow-art.jpg',
  },
};

const baseContext: EmbedContext = {
  communityName: 'Test Guild',
  clientUrl: 'http://localhost:5173',
};

function createFeaturesFactory() {
  const emojiService = {
    getRoleEmoji: jest.fn((role: string) => UNICODE_FALLBACK[role] ?? ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService;
  return new DiscordEmbedFactory(emojiService);
}

function makeMmoMentionEvent(
  mentions: EmbedEventData['signupMentions'],
  roleCounts: Record<string, number>,
): EmbedEventData {
  return {
    ...baseEvent,
    signupCount: mentions?.length ?? 0,
    roleCounts,
    signupMentions: mentions,
  };
}

describe('DiscordEmbedFactory — duration formatting', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFeaturesFactory();
  });

  it('should format hours-only duration', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON()
        .description,
    ).toContain('3h');
  });

  it('should format hours and minutes duration', () => {
    expect(
      factory
        .buildEventEmbed(
          { ...baseEvent, endTime: '2026-02-20T21:30:00.000Z' },
          baseContext,
        )
        .embed.toJSON().description,
    ).toContain('1h 30m');
  });

  it('should format minutes-only duration', () => {
    expect(
      factory
        .buildEventEmbed(
          { ...baseEvent, endTime: '2026-02-20T20:45:00.000Z' },
          baseContext,
        )
        .embed.toJSON().description,
    ).toContain('45m');
  });
});

describe('DiscordEmbedFactory — buildEventInvite basics', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFeaturesFactory();
  });

  it('uses the needs-you colour for invites', () => {
    expect(
      factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON()
        .color,
    ).toBe(EMBED_COLORS.REMINDER);
  });

  it('should set the title with invite text', () => {
    expect(
      factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON()
        .title,
    ).toBe("You're invited to **Mythic Raid Night**!");
  });

  it('should include game name in description', () => {
    expect(
      factory.buildEventInvite(baseEvent, baseContext, 'inviter').embed.toJSON()
        .description,
    ).toContain('World of Warcraft');
  });

  it('should include Discord native timestamp', () => {
    const desc = factory
      .buildEventInvite(baseEvent, baseContext, 'inviter')
      .embed.toJSON().description;
    expect(desc).toContain('\uD83D\uDCC6');
    expect(desc).toContain('<t:1771617600:f>');
    expect(desc).toContain('<t:1771617600:R>');
  });
});

describe('DiscordEmbedFactory — buildEventInvite details', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFeaturesFactory();
  });

  it('should include description excerpt', () => {
    expect(
      factory
        .buildEventInvite(
          { ...baseEvent, description: 'Weekly mythic progression' },
          baseContext,
          'inviter',
        )
        .embed.toJSON().description,
    ).toContain('Weekly mythic progression');
  });

  it('should truncate long descriptions to 200 chars', () => {
    const longDesc = 'A'.repeat(250);
    expect(
      factory
        .buildEventInvite(
          { ...baseEvent, description: longDesc },
          baseContext,
          'inviter',
        )
        .embed.toJSON().description,
    ).toContain('...');
  });

  it('should include inviter on the author line and community in footer', () => {
    const json = factory
      .buildEventInvite(baseEvent, baseContext, 'inviter')
      .embed.toJSON();
    // The inviter moved from the footer to the author line (ROK-1460).
    expect(json.author?.name).toBe('\u2709 INVITED BY inviter');
    expect(json.footer?.text).toBe('Test Guild');
  });

  it('should include a View Event link button', () => {
    const { row } = factory.buildEventInvite(baseEvent, baseContext, 'inviter');
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
    expect(
      factory.buildEventInvite(
        baseEvent,
        { communityName: 'Test', clientUrl: null },
        'inviter',
      ).row,
    ).toBeUndefined();
    process.env.CLIENT_URL = origEnv;
  });
});

describe('DiscordEmbedFactory — Discord native timestamps (ROK-431)', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFeaturesFactory();
  });

  it('should use Discord timestamp syntax regardless of timezone setting', () => {
    const desc = factory
      .buildEventEmbed(baseEvent, {
        ...baseContext,
        timezone: 'America/New_York',
      })
      .embed.toJSON().description!;
    expect(desc).toContain('<t:1771617600:f>');
    expect(desc).toContain('<t:1771617600:R>');
    expect(desc).not.toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
  });

  it('should produce the same output with or without timezone', () => {
    const descWithTz = factory
      .buildEventEmbed(baseEvent, {
        ...baseContext,
        timezone: 'America/Los_Angeles',
      })
      .embed.toJSON().description!;
    const descWithoutTz = factory
      .buildEventEmbed(baseEvent, { ...baseContext, timezone: null })
      .embed.toJSON().description!;
    expect(descWithTz).toBe(descWithoutTz);
  });

  it('should use Discord timestamps in invite embeds', () => {
    const desc = factory
      .buildEventInvite(baseEvent, baseContext, 'inviter')
      .embed.toJSON().description!;
    expect(desc).toContain('<t:1771617600:f>');
    expect(desc).toContain('<t:1771617600:R>');
  });
});

describe('DiscordEmbedFactory — role badges MMO roster (ROK-470)', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFeaturesFactory();
  });

  it('should show role emoji badges next to player mentions in MMO roster', () => {
    const event = makeMmoMentionEvent(
      [
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
      { tank: 1, healer: 1, dps: 1 },
    );
    const desc = factory
      .buildEventEmbed(event, baseContext)
      .embed.toJSON().description!;
    expect(desc).toContain('**TankPlayer** \u{1F6E1}\uFE0F\u2694\uFE0F');
    expect(desc).toContain('**HealerPlayer** \u{1F49A}');
    expect(desc).toContain(
      '**DpsPlayer** \u{1F6E1}\uFE0F\u{1F49A}\u2694\uFE0F',
    );
    expect(desc).not.toContain('<@');
  });

  it('should show just the name when player has no preferred roles and no assigned role', () => {
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
    const desc = factory
      .buildEventEmbed(eventWithNoPrefs, baseContext)
      .embed.toJSON().description!;
    expect(desc).toContain('**NoRolePlayer**');
    expect(desc).not.toContain('<@');
    expect(desc).not.toMatch(
      /\*\*NoRolePlayer\*\* ?[\u{1F6E1}\u{1F49A}\u2694]/u,
    );
  });
});

describe('DiscordEmbedFactory — role badges fallback & variants (ROK-470)', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFeaturesFactory();
  });

  it('should fall back to assigned role emoji when preferredRoles is empty', () => {
    const event = makeMmoMentionEvent(
      [
        {
          discordId: '555',
          username: 'AssignedTank',
          role: 'tank',
          preferredRoles: [],
          status: 'signed_up',
        },
      ],
      { tank: 1 },
    );
    const desc = factory
      .buildEventEmbed(event, baseContext)
      .embed.toJSON().description!;
    expect(desc).toContain('**AssignedTank** \u{1F6E1}\uFE0F');
  });

  it('should combine tentative prefix with role badges', () => {
    const event = makeMmoMentionEvent(
      [
        {
          discordId: '666',
          username: 'TentativeHealer',
          role: 'healer',
          preferredRoles: ['healer', 'dps'],
          status: 'tentative',
        },
      ],
      { healer: 1 },
    );
    const desc = factory
      .buildEventEmbed(event, baseContext)
      .embed.toJSON().description!;
    expect(desc).toContain('\u23F3 **TentativeHealer** \u{1F49A}\u2694\uFE0F');
  });
});

describe('DiscordEmbedFactory — role badges username & non-MMO (ROK-470)', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFeaturesFactory();
  });

  it('should show username with role badges when no discordId', () => {
    const event = makeMmoMentionEvent(
      [
        {
          discordId: null,
          username: 'WebOnlyUser',
          role: 'dps',
          preferredRoles: ['dps'],
          status: 'signed_up',
        },
      ],
      { dps: 1 },
    );
    const desc = factory
      .buildEventEmbed(event, baseContext)
      .embed.toJSON().description!;
    expect(desc).toContain('**WebOnlyUser** \u2694\uFE0F');
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
    const desc = factory
      .buildEventEmbed(simpleEventWithMentions, baseContext)
      .embed.toJSON().description!;
    expect(desc).toContain('**Player1** \u{1F6E1}\uFE0F\u{1F49A}');
    expect(desc).toContain('**Player2**');
    expect(desc).not.toContain('<@');
    expect(desc).not.toMatch(/\*\*Player2\*\* ?[\u{1F6E1}\u{1F49A}\u2694]/u);
  });
});
