/**
 * ROK-1459 (slice A) — shared embed chrome.
 *
 * TDD spec written BEFORE `embed-chrome.helpers.ts` exists. Every test here
 * must fail with "Cannot find module './embed-chrome.helpers'" until the dev
 * lands the module.
 *
 * Covers AC1 (colorForState), AC2 (applyEmbedChrome author/footer/colour/
 * timestamp on both surfaces) and the RUNTIME half of AC3 (a channel embed
 * carrying a personalized field throws). The COMPILE-TIME half of AC3 lives in
 * `embed-personalized.helpers.spec.ts`.
 */
import { EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
import {
  colorForState,
  applyEmbedChrome,
  createChannelEmbed,
  createDmEmbed,
  type EmbedState,
  type EmbedSurface,
} from './embed-chrome.helpers';
import { PERSONALIZED_FIELD_NAMES } from './embed-personalized.helpers';

const SURFACES: EmbedSurface[] = ['channel', 'dm'];

/** First canonical personalized field name — drives the runtime guard test. */
function firstPersonalizedName(): string {
  const names = [...(PERSONALIZED_FIELD_NAMES as Iterable<string>)];
  if (names.length === 0) {
    throw new Error('PERSONALIZED_FIELD_NAMES must not be empty');
  }
  return names[0];
}

describe('colorForState (AC1)', () => {
  const cases: [EmbedState, number][] = [
    ['announcing', EMBED_COLORS.ANNOUNCEMENT],
    ['needs_you', EMBED_COLORS.REMINDER],
    ['live', EMBED_COLORS.SIGNUP_CONFIRMATION],
    ['done', EMBED_COLORS.SYSTEM],
    ['cancelled', EMBED_COLORS.ERROR],
  ];

  it.each(cases)('maps %s to the matching palette entry', (state, expected) => {
    expect(colorForState(state)).toBe(expected);
  });

  it('maps every state to a distinct colour', () => {
    const colors = cases.map(([state]) => colorForState(state));
    expect(new Set(colors).size).toBe(cases.length);
  });
});

describe('applyEmbedChrome — author (AC2)', () => {
  it.each(SURFACES)(
    'defaults the author to the community name (%s)',
    (surface) => {
      const embed = new EmbedBuilder();
      applyEmbedChrome(embed, {
        surface,
        state: 'announcing',
        communityName: 'Night Owls',
      });
      expect(embed.toJSON().author?.name).toBe('Night Owls');
    },
  );

  it.each(SURFACES)(
    'falls back to "Raid Ledger" without a community (%s)',
    (surface) => {
      const embed = new EmbedBuilder();
      applyEmbedChrome(embed, {
        surface,
        state: 'announcing',
        communityName: null,
      });
      expect(embed.toJSON().author?.name).toBe('Raid Ledger');
    },
  );

  it.each(SURFACES)(
    'uses authorLine over the community name (%s)',
    (surface) => {
      const embed = new EmbedBuilder();
      applyEmbedChrome(embed, {
        surface,
        state: 'live',
        communityName: 'Night Owls',
        authorLine: '▸ LIVE · 3 playing',
      });
      expect(embed.toJSON().author?.name).toBe('▸ LIVE · 3 playing');
    },
  );

  it('carries authorUrl through when supplied', () => {
    const embed = new EmbedBuilder();
    applyEmbedChrome(embed, {
      surface: 'channel',
      state: 'announcing',
      communityName: 'Night Owls',
      authorUrl: 'https://raid.example/community',
    });
    expect(embed.toJSON().author?.url).toBe('https://raid.example/community');
  });
});

describe('applyEmbedChrome — footer, colour, timestamp (AC2)', () => {
  it.each(SURFACES)(
    'renders "community · label" when a label is given (%s)',
    (surface) => {
      const embed = new EmbedBuilder();
      applyEmbedChrome(embed, {
        surface,
        state: 'announcing',
        communityName: 'Night Owls',
        footerLabel: 'Nominations Open',
      });
      expect(embed.toJSON().footer?.text).toBe('Night Owls · Nominations Open');
    },
  );

  it.each(SURFACES)(
    'renders the community alone without a label (%s)',
    (surface) => {
      const embed = new EmbedBuilder();
      applyEmbedChrome(embed, {
        surface,
        state: 'announcing',
        communityName: 'Night Owls',
      });
      expect(embed.toJSON().footer?.text).toBe('Night Owls');
    },
  );

  it('falls back to "Raid Ledger" in the footer too', () => {
    const embed = new EmbedBuilder();
    applyEmbedChrome(embed, {
      surface: 'dm',
      state: 'done',
      footerLabel: 'Wrapped',
    });
    expect(embed.toJSON().footer?.text).toBe('Raid Ledger · Wrapped');
  });
});

describe('applyEmbedChrome — colour and timestamp (AC2)', () => {
  it.each(SURFACES)('sets the colour from the state (%s)', (surface) => {
    const embed = new EmbedBuilder();
    applyEmbedChrome(embed, {
      surface,
      state: 'cancelled',
      communityName: 'Night Owls',
    });
    expect(embed.toJSON().color).toBe(EMBED_COLORS.ERROR);
  });

  it.each(SURFACES)('sets a timestamp by default (%s)', (surface) => {
    const embed = new EmbedBuilder();
    applyEmbedChrome(embed, {
      surface,
      state: 'announcing',
      communityName: 'Night Owls',
    });
    expect(typeof embed.toJSON().timestamp).toBe('string');
  });

  it.each(SURFACES)('omits the timestamp when disabled (%s)', (surface) => {
    const embed = new EmbedBuilder();
    applyEmbedChrome(embed, {
      surface,
      state: 'announcing',
      communityName: 'Night Owls',
      timestamp: false,
    });
    expect(embed.toJSON().timestamp).toBeUndefined();
  });
});

describe('createChannelEmbed / createDmEmbed (AC2)', () => {
  it('createChannelEmbed applies the same chrome as applyEmbedChrome', () => {
    const built = createChannelEmbed({
      state: 'needs_you',
      communityName: 'Night Owls',
      footerLabel: 'Fill Request',
    }).toJSON();
    expect(built.author?.name).toBe('Night Owls');
    expect(built.footer?.text).toBe('Night Owls · Fill Request');
    expect(built.color).toBe(EMBED_COLORS.REMINDER);
  });

  it('createDmEmbed applies the same chrome as applyEmbedChrome', () => {
    const built = createDmEmbed({
      state: 'live',
      communityName: 'Night Owls',
      footerLabel: 'Now Playing',
    }).toJSON();
    expect(built.author?.name).toBe('Night Owls');
    expect(built.footer?.text).toBe('Night Owls · Now Playing');
    expect(built.color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
  });
});

describe('applyEmbedChrome — personalized-field guard, runtime half (AC3)', () => {
  it('throws when a channel embed already carries a personalized field', () => {
    const embed = new EmbedBuilder().addFields({
      name: firstPersonalizedName(),
      value: 'Half-Life 3',
    });
    expect(() =>
      applyEmbedChrome(embed, {
        surface: 'channel',
        state: 'announcing',
        communityName: 'Night Owls',
      }),
    ).toThrow(/personalized field on channel embed/i);
  });

  it('accepts the same personalized field on the dm surface', () => {
    const embed = new EmbedBuilder().addFields({
      name: firstPersonalizedName(),
      value: 'Half-Life 3',
    });
    expect(() =>
      applyEmbedChrome(embed, {
        surface: 'dm',
        state: 'announcing',
        communityName: 'Night Owls',
      }),
    ).not.toThrow();
    expect(embed.toJSON().footer?.text).toBe('Night Owls');
  });

  it('does not throw for an ordinary channel field', () => {
    const embed = new EmbedBuilder().addFields({
      name: '\u{1F465} Players (3)',
      value: 'Ana, Bo, Cy',
    });
    expect(() =>
      applyEmbedChrome(embed, {
        surface: 'channel',
        state: 'announcing',
        communityName: 'Night Owls',
      }),
    ).not.toThrow();
  });
});

describe('createChannelEmbed rejects personalized fields at write time (F2)', () => {
  const personalizedField = () => ({
    name: firstPersonalizedName(),
    value: 'Half-Life 3',
  });

  it('throws when addFields is handed a personalized field', () => {
    const embed = createChannelEmbed({
      state: 'announcing',
      communityName: 'Night Owls',
    });
    expect(() => embed.addFields(personalizedField())).toThrow(
      /personalized field on channel embed/i,
    );
  });

  it('throws when setFields is handed a personalized field', () => {
    const embed = createChannelEmbed({
      state: 'announcing',
      communityName: 'Night Owls',
    });
    expect(() => embed.setFields(personalizedField())).toThrow(
      /personalized field on channel embed/i,
    );
  });

  it('throws when spliceFields is handed a personalized field', () => {
    const embed = createChannelEmbed({
      state: 'announcing',
      communityName: 'Night Owls',
    });
    expect(() => embed.spliceFields(0, 0, personalizedField())).toThrow(
      /personalized field on channel embed/i,
    );
  });

  it('still accepts ordinary channel fields', () => {
    const embed = createChannelEmbed({
      state: 'announcing',
      communityName: 'Night Owls',
    });
    expect(() =>
      embed.addFields({ name: '\u{1F465} Players (3)', value: 'Ana, Bo' }),
    ).not.toThrow();
    expect(embed.toJSON().fields).toHaveLength(1);
  });

  it('createDmEmbed accepts the same personalized field', () => {
    const embed = createDmEmbed({
      state: 'announcing',
      communityName: 'Night Owls',
    });
    expect(() => embed.addFields(personalizedField())).not.toThrow();
    expect(embed.toJSON().fields).toHaveLength(1);
  });
});

describe('applyEmbedChrome — refuses Discord timestamp markup (ROK-1461)', () => {
  /**
   * Operator walk 2026-09-02: Discord renders `<t:epoch:style>` in an embed's
   * description and fields, but NOT in the author line or footer — the lineup
   * and poll cards showed readers the literal token. The chrome now refuses
   * the markup so the next family cannot rediscover this the same way.
   */
  const TOKEN = '<t:1788536142:R>';

  it('throws when the author line carries a timestamp token', () => {
    expect(() =>
      applyEmbedChrome(new EmbedBuilder(), {
        surface: 'channel',
        state: 'announcing',
        communityName: 'Night Owls',
        authorLine: `\u{1F3B2} NOMINATIONS OPEN \u00B7 closes ${TOKEN}`,
      }),
    ).toThrow(/timestamp markup in authorLine/i);
  });

  it('throws when the footer label carries a timestamp token', () => {
    expect(() =>
      applyEmbedChrome(new EmbedBuilder(), {
        surface: 'channel',
        state: 'announcing',
        communityName: 'Night Owls',
        footerLabel: `Closes ${TOKEN}`,
      }),
    ).toThrow(/timestamp markup in footerLabel/i);
  });

  it('accepts a server-side rendered delta', () => {
    const embed = new EmbedBuilder();
    applyEmbedChrome(embed, {
      surface: 'channel',
      state: 'announcing',
      communityName: 'Night Owls',
      authorLine: '\u{1F3B2} NOMINATIONS OPEN \u00B7 closes in 2 days',
    });
    expect(embed.toJSON().author?.name).toContain('closes in 2 days');
  });
});
