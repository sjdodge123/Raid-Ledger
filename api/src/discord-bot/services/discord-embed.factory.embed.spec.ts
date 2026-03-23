/**
 * DiscordEmbedFactory — buildEventEmbed, state colors, buildEventCancelled, deprecated aliases tests.
 */
import {
  DiscordEmbedFactory,
  type EmbedEventData,
  type EmbedContext,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import { EMBED_COLORS, EMBED_STATES } from '../discord-bot.constants';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

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

function createFactory() {
  const emojiService = {
    getRoleEmoji: jest.fn((role: string) => UNICODE_FALLBACK[role] ?? ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService;
  return new DiscordEmbedFactory(emojiService);
}

describe('buildEventEmbed — basic fields', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should build an embed with cyan color by default (posted state)', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON().color,
    ).toBe(EMBED_COLORS.ANNOUNCEMENT);
  });

  it('should set the title with calendar emoji prefix', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON().title,
    ).toBe('\uD83D\uDCC5 Mythic Raid Night');
  });

  it('should set the author to Raid Ledger', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON().author
        ?.name,
    ).toBe('Raid Ledger');
  });

  it('should include game name in the description', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON()
        .description,
    ).toContain('World of Warcraft');
  });

  it('should include Discord native timestamp in the description', () => {
    const desc = factory
      .buildEventEmbed(baseEvent, baseContext)
      .embed.toJSON().description;
    expect(desc).toContain('\uD83D\uDCC6');
    expect(desc).toContain('<t:1771617600:f>');
    expect(desc).toContain('<t:1771617600:R>');
  });

  it('should include duration in the description', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON()
        .description,
    ).toContain('3h');
  });

  it('should include roster breakdown for MMO slot config', () => {
    const desc = factory
      .buildEventEmbed(baseEvent, baseContext)
      .embed.toJSON().description;
    expect(desc).toContain('ROSTER:');
    expect(desc).toContain('**Tanks** (');
    expect(desc).toContain('**Healers** (');
    expect(desc).toContain('**DPS** (');
  });

  it('should set game art as thumbnail', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON().thumbnail
        ?.url,
    ).toBe('https://example.com/wow-art.jpg');
  });
});

describe('buildEventEmbed — footer & URL', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should include community name in footer', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON().footer
        ?.text,
    ).toBe('Test Guild');
  });

  it('should set URL on title for clickable link (ROK-399)', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext).embed.toJSON().url,
    ).toBe('http://localhost:5173/events/42');
  });
});

describe('buildEventEmbed — buttons', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should include signup action buttons by default', () => {
    const { row } = factory.buildEventEmbed(baseEvent, baseContext);
    expect(row).toBeDefined();
    const components = row!.toJSON().components as {
      label?: string;
      url?: string;
      style?: number;
    }[];
    expect(components).toHaveLength(4);
    expect(components[0].label).toBe('Sign Up');
    expect(components[0].style).toBe(3);
    expect(components[1].label).toBe('Tentative');
    expect(components[2].label).toBe('Decline');
    expect(components[3].label).toBe('View Event');
    expect(components[3].url).toBe('http://localhost:5173/events/42');
  });

  it('should use "view" button mode with only View Event link', () => {
    const { row } = factory.buildEventEmbed(baseEvent, baseContext, {
      buttons: 'view',
    });
    const components = row!.toJSON().components as { label?: string }[];
    expect(components).toHaveLength(1);
    expect(components[0].label).toBe('View Event');
  });

  it('should omit row with "none" button mode', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext, { buttons: 'none' }).row,
    ).toBeUndefined();
  });
});

describe('buildEventEmbed — custom & terminal-state buttons', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
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
    const components = row!.toJSON().components as { label?: string }[];
    expect(components).toHaveLength(1);
    expect(components[0].label).toBe('Custom Button');
  });

  it('should omit buttons for cancelled state regardless of button mode', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.CANCELLED,
        buttons: 'signup',
      }).row,
    ).toBeUndefined();
  });

  it('should omit buttons for completed state regardless of button mode', () => {
    expect(
      factory.buildEventEmbed(baseEvent, baseContext, {
        state: EMBED_STATES.COMPLETED,
        buttons: 'signup',
      }).row,
    ).toBeUndefined();
  });
});

describe('buildEventEmbed — edge cases', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should handle events without game data', () => {
    const { embed } = factory.buildEventEmbed(
      { ...baseEvent, game: null },
      baseContext,
    );
    expect(embed.toJSON().description).not.toContain('\uD83C\uDFAE');
    expect(embed.toJSON().thumbnail).toBeUndefined();
  });

  it('should handle events without slot config', () => {
    const { embed } = factory.buildEventEmbed(
      { ...baseEvent, slotConfig: null, maxAttendees: 10, signupCount: 5 },
      baseContext,
    );
    expect(embed.toJSON().description).toContain('ROSTER: 5/10');
  });

  it('should handle events without max attendees or slot config', () => {
    const { embed } = factory.buildEventEmbed(
      { ...baseEvent, slotConfig: null, maxAttendees: null, signupCount: 3 },
      baseContext,
    );
    expect(embed.toJSON().description).toContain('3 signed up');
  });

  it('should not include roster line when no signups and no max', () => {
    const { embed } = factory.buildEventEmbed(
      { ...baseEvent, slotConfig: null, maxAttendees: null, signupCount: 0 },
      baseContext,
    );
    expect(embed.toJSON().description).not.toContain('ROSTER');
  });
});

describe('buildEventEmbed — URL & fallback edge cases', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should omit View Event link button when no client URL but keep signup buttons', () => {
    const origEnv = process.env.CLIENT_URL;
    delete process.env.CLIENT_URL;
    const { row } = factory.buildEventEmbed(baseEvent, {
      communityName: 'Test',
      clientUrl: null,
    });
    expect(row).toBeDefined();
    const components = row!.toJSON().components as { label?: string }[];
    expect(components).toHaveLength(3);
    expect(components[0].label).toBe('Sign Up');
    process.env.CLIENT_URL = origEnv;
  });

  it('should use fallback community name when not set', () => {
    const { embed } = factory.buildEventEmbed(baseEvent, {
      communityName: null,
      clientUrl: 'http://localhost:5173',
    });
    expect(embed.toJSON().footer?.text).toBe('Raid Ledger');
  });

  it('should omit row with "view" button mode when no client URL', () => {
    const origEnv = process.env.CLIENT_URL;
    delete process.env.CLIENT_URL;
    const { row } = factory.buildEventEmbed(
      baseEvent,
      { communityName: 'Test', clientUrl: null },
      { buttons: 'view' },
    );
    expect(row).toBeUndefined();
    process.env.CLIENT_URL = origEnv;
  });
});

describe('buildEventEmbed — state colors', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should use cyan for posted state', () => {
    expect(
      factory
        .buildEventEmbed(baseEvent, baseContext, {
          state: EMBED_STATES.POSTED,
        })
        .embed.toJSON().color,
    ).toBe(EMBED_COLORS.ANNOUNCEMENT);
  });

  it('should use amber for imminent state', () => {
    expect(
      factory
        .buildEventEmbed(baseEvent, baseContext, {
          state: EMBED_STATES.IMMINENT,
        })
        .embed.toJSON().color,
    ).toBe(EMBED_COLORS.REMINDER);
  });

  it('should use emerald for live state', () => {
    expect(
      factory
        .buildEventEmbed(baseEvent, baseContext, { state: EMBED_STATES.LIVE })
        .embed.toJSON().color,
    ).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
  });

  it('should use slate for completed state', () => {
    expect(
      factory
        .buildEventEmbed(baseEvent, baseContext, {
          state: EMBED_STATES.COMPLETED,
        })
        .embed.toJSON().color,
    ).toBe(EMBED_COLORS.SYSTEM);
  });

  it('should use red for cancelled state', () => {
    expect(
      factory
        .buildEventEmbed(baseEvent, baseContext, {
          state: EMBED_STATES.CANCELLED,
        })
        .embed.toJSON().color,
    ).toBe(EMBED_COLORS.ERROR);
  });
});

describe('buildEventEmbed — state-aware push content (ROK-866)', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should use event push content for posted state', () => {
    const shortEvent = { ...baseEvent, title: 'Raid', game: null };
    const { content } = factory.buildEventEmbed(shortEvent, baseContext, {
      state: EMBED_STATES.POSTED,
    });
    expect(content).toContain('Raid');
    expect(content).toContain('signed up');
  });

  it('should use cancelled push content when state is CANCELLED', () => {
    const { content } = factory.buildEventEmbed(baseEvent, baseContext, {
      state: EMBED_STATES.CANCELLED,
    });
    expect(content).toContain('Cancelled');
    expect(content).toContain('Mythic Raid Night');
    expect(content).not.toContain('signed up');
  });

  it('should use completed push content when state is COMPLETED', () => {
    const { content } = factory.buildEventEmbed(baseEvent, baseContext, {
      state: EMBED_STATES.COMPLETED,
    });
    expect(content).toContain('Completed');
    expect(content).toContain('Mythic Raid Night');
    expect(content).not.toContain('signed up');
  });

  it('should use event push content for filling state', () => {
    const shortEvent = { ...baseEvent, title: 'Raid', game: null };
    const { content } = factory.buildEventEmbed(shortEvent, baseContext, {
      state: EMBED_STATES.FILLING,
    });
    expect(content).toContain('signed up');
  });

  it('should use event push content for live state', () => {
    const shortEvent = { ...baseEvent, title: 'Raid', game: null };
    const { content } = factory.buildEventEmbed(shortEvent, baseContext, {
      state: EMBED_STATES.LIVE,
    });
    expect(content).toContain('signed up');
  });
});

describe('buildEventEmbed — timezone threading (ROK-918)', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should thread context.timezone into push content for posted state', () => {
    // baseEvent startTime: 2026-02-20T20:00:00Z = Feb 20, 3:00 PM in America/New_York
    const { content } = factory.buildEventEmbed(
      baseEvent,
      { ...baseContext, timezone: 'America/New_York' },
      { state: EMBED_STATES.POSTED },
    );
    expect(content).toContain('Feb 20');
    expect(content).toContain('3:00');
    expect(content).toContain('PM');
  });

  it('should produce different push content time when timezone shifts the hour', () => {
    // Use two explicit timezones that always differ regardless of test machine locale:
    // UTC vs Asia/Tokyo (+9h): same epoch shows different hours guaranteed
    const withUtc = factory.buildEventEmbed(baseEvent, {
      ...baseContext,
      timezone: 'UTC',
    }).content;
    const withTokyo = factory.buildEventEmbed(baseEvent, {
      ...baseContext,
      timezone: 'Asia/Tokyo',
    }).content;
    // 2026-02-20T20:00:00Z = 8:00 PM UTC vs 5:00 AM (+1 day) Tokyo — always different
    expect(withUtc).not.toBe(withTokyo);
  });

  it('should NOT use timezone for CANCELLED state push content', () => {
    // Cancelled content is just "Cancelled: <title>" — no date, so timezone is irrelevant
    const { content } = factory.buildEventEmbed(
      baseEvent,
      { ...baseContext, timezone: 'America/New_York' },
      { state: EMBED_STATES.CANCELLED },
    );
    expect(content).toContain('Cancelled');
    expect(content).toContain('Mythic Raid Night');
    expect(content).not.toContain('signed up');
    expect(content).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('should NOT use timezone for COMPLETED state push content', () => {
    // Completed content is "<title> -- Completed" — no date, timezone is irrelevant
    const { content } = factory.buildEventEmbed(
      baseEvent,
      { ...baseContext, timezone: 'Asia/Tokyo' },
      { state: EMBED_STATES.COMPLETED },
    );
    expect(content).toContain('Completed');
    expect(content).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('should use timezone for IMMINENT state push content', () => {
    const { content } = factory.buildEventEmbed(
      baseEvent,
      { ...baseContext, timezone: 'UTC' },
      { state: EMBED_STATES.IMMINENT },
    );
    // UTC: 2026-02-20T20:00:00Z = 8:00 PM UTC
    expect(content).toContain('8:00');
    expect(content).toContain('PM');
  });

  it('should use timezone for FULL state push content', () => {
    const fullEvent = {
      ...baseEvent,
      title: 'Raid',
      game: null,
      signupCount: 20,
      maxAttendees: 20,
    };
    const { content } = factory.buildEventEmbed(
      fullEvent,
      { ...baseContext, timezone: 'UTC' },
      { state: EMBED_STATES.FULL },
    );
    expect(content).toContain('signed up');
  });

  it('should produce same output whether timezone is null or undefined in context', () => {
    const withNull = factory.buildEventEmbed(baseEvent, {
      ...baseContext,
      timezone: null,
    }).content;
    const withUndefined = factory.buildEventEmbed(baseEvent, {
      communityName: baseContext.communityName,
      clientUrl: baseContext.clientUrl,
    }).content;
    expect(withNull).toBe(withUndefined);
  });
});

describe('buildEventCancelled', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('should use red accent color', () => {
    expect(
      factory.buildEventCancelled(baseEvent, baseContext).embed.toJSON().color,
    ).toBe(EMBED_COLORS.ERROR);
  });

  it('should strikethrough the title', () => {
    const title = factory
      .buildEventCancelled(baseEvent, baseContext)
      .embed.toJSON().title;
    expect(title).toContain('~~Mythic Raid Night~~');
    expect(title).toContain('CANCELLED');
  });

  it('should indicate cancellation in description', () => {
    expect(
      factory.buildEventCancelled(baseEvent, baseContext).embed.toJSON()
        .description,
    ).toContain('cancelled');
  });
});

describe('deprecated aliases', () => {
  let factory: DiscordEmbedFactory;

  beforeEach(() => {
    factory = createFactory();
  });

  it('buildEventAnnouncement delegates to buildEventEmbed', () => {
    const announcement = factory.buildEventAnnouncement(baseEvent, baseContext);
    const embed = factory.buildEventEmbed(baseEvent, baseContext);
    expect({ ...announcement.embed.toJSON(), timestamp: null }).toEqual({
      ...embed.embed.toJSON(),
      timestamp: null,
    });
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
    expect({ ...update.embed.toJSON(), timestamp: null }).toEqual({
      ...embed.embed.toJSON(),
      timestamp: null,
    });
  });
});
