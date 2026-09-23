/**
 * Unit tests for the weekly-digest embed builder (ROK-1435 slice L3).
 * Pins: every section rendered in order and non-inline; empty sections
 * omitted (all-empty ⇒ null); the 1024-char fitting boundary and the "+N more"
 * count; the per-section link targets and the no-origin fallback; Discord's
 * embed totals; and that nothing identifying a member (or a mention) renders.
 */
import { embedLength, type APIEmbedField } from 'discord.js';
import { colorForState } from '../discord-bot/embeds/embed-chrome.helpers';
import type {
  DigestDealLine,
  DigestLfgLine,
  DigestPlayingLine,
  DigestSections,
} from './weekly-digest-data.helpers';
import {
  DIGEST_DESCRIPTION,
  DIGEST_FIELD_NAMES,
  buildWeeklyDigestEmbed,
  digestTitle,
} from './weekly-digest-embed.helpers';
import {
  DIGEST_EMBED_LIMITS,
  DIGEST_NAME_MAX,
  fitSectionLines,
  sanitizeName,
} from './weekly-digest-embed-text.helpers';

const ORIGIN = 'https://raid.example.test';
const END = new Date('2026-09-22T12:00:00Z');

function playing(n: number, total = n): DigestSections['playing'] {
  const items: DigestPlayingLine[] = Array.from({ length: n }, (_, i) => ({
    gameId: i + 1,
    name: `Game ${String(i + 1)}`,
    slug: `game-${String(i + 1)}`,
    playerCount: i + 1,
  }));
  return { items, total };
}

function deal(gameId: number, price: number | null): DigestDealLine {
  return {
    gameId,
    name: `Deal ${String(gameId)}`,
    slug: 'd',
    cutPercent: 40,
    price,
  };
}

function lfgLine(
  slug: string,
  extra: Partial<DigestLfgLine> = {},
): DigestLfgLine {
  return {
    gameName: `LFG ${slug}`,
    gameSlug: slug,
    activeCount: 3,
    nowCount: 1,
    isViable: false,
    playersNeeded: 2,
    ...extra,
  };
}

function full(): DigestSections {
  return {
    playing: playing(2),
    recap: { eventsRun: 4, playersAttended: 9, attendances: 17 },
    deals: { items: [deal(7, 29.99), deal(8, null)], total: 2 },
    lfg: {
      items: [
        lfgLine('valheim'),
        lfgLine('wow', { isViable: true, activeCount: 5 }),
      ],
      total: 2,
    },
  };
}

function empty(): DigestSections {
  return {
    playing: { items: [], total: 0 },
    recap: null,
    deals: { items: [], total: 0 },
    lfg: { items: [], total: 0 },
  };
}

function build(sections: DigestSections, clientUrl: string | null = ORIGIN) {
  const embed = buildWeeklyDigestEmbed({ sections, clientUrl, windowEnd: END });
  if (!embed) throw new Error('expected an embed, got null');
  return embed;
}

function fieldNamed(fields: APIEmbedField[] | undefined, name: string) {
  return fields?.find((f) => f.name === name)?.value;
}

describe('buildWeeklyDigestEmbed — sections', () => {
  it('renders all four sections, in order, full width', () => {
    const data = build(full()).toJSON();
    expect(data.fields?.map((f) => f.name)).toEqual([
      DIGEST_FIELD_NAMES.playing,
      DIGEST_FIELD_NAMES.recap,
      DIGEST_FIELD_NAMES.deals,
      DIGEST_FIELD_NAMES.lfg,
    ]);
    expect(data.fields?.every((f) => f.inline === false)).toBe(true);
  });

  it('renders each section line with its facts and link', () => {
    const fields = build(full()).toJSON().fields;
    expect(fieldNamed(fields, DIGEST_FIELD_NAMES.playing)).toBe(
      `**[Game 1](${ORIGIN}/games/1)** · 1 player\n` +
        `**[Game 2](${ORIGIN}/games/2)** · 2 players\n` +
        `[see all ↗](${ORIGIN}/games)`,
    );
    expect(fieldNamed(fields, DIGEST_FIELD_NAMES.recap)).toBe(
      `**4** events · **9** players\n[past events ↗](${ORIGIN}/events?tab=past)`,
    );
    expect(fieldNamed(fields, DIGEST_FIELD_NAMES.deals)).toBe(
      `**[Deal 7](${ORIGIN}/games/7)** −40% · $29.99\n` +
        `**[Deal 8](${ORIGIN}/games/8)** −40%\n` +
        `[see all ↗](${ORIGIN}/games)`,
    );
    expect(fieldNamed(fields, DIGEST_FIELD_NAMES.lfg)).toBe(
      `**[LFG valheim](${ORIGIN}/lfg/valheim)** · 3 looking · needs 2 more\n` +
        `**[LFG wow](${ORIGIN}/lfg/wow)** · 5 looking · ready\n` +
        `[see all ↗](${ORIGIN}/games?lfg=1)`,
    );
  });

  it('uses the shared channel chrome: state colour, footer, author link, title', () => {
    const data = build(full()).toJSON();
    expect(data.color).toBe(colorForState('announcing'));
    expect(data.footer?.text).toBe('Raid Ledger · Weekly digest');
    expect(data.author?.url).toBe(`${ORIGIN}/games`);
    expect(data.title).toBe('Week in review — Sep 15 to Sep 22');
    expect(data.description).toBe(DIGEST_DESCRIPTION);
  });

  it('formats the title range in the given time zone', () => {
    const lateUtc = new Date('2026-09-22T02:00:00Z');
    expect(digestTitle(lateUtc, 'America/Los_Angeles')).toBe(
      'Week in review — Sep 14 to Sep 21',
    );
  });
});

describe('buildWeeklyDigestEmbed — empty sections', () => {
  it('returns null when every section is empty (L4 skips the post)', () => {
    expect(
      buildWeeklyDigestEmbed({
        sections: empty(),
        clientUrl: ORIGIN,
        windowEnd: END,
      }),
    ).toBeNull();
  });

  it.each([
    [
      'playing',
      DIGEST_FIELD_NAMES.playing,
      { playing: { items: [], total: 0 } },
    ],
    ['recap', DIGEST_FIELD_NAMES.recap, { recap: null }],
    ['deals', DIGEST_FIELD_NAMES.deals, { deals: { items: [], total: 0 } }],
    ['lfg (AC5)', DIGEST_FIELD_NAMES.lfg, { lfg: { items: [], total: 0 } }],
  ] as Array<[string, string, Partial<DigestSections>]>)(
    'omits the %s field entirely when it is empty',
    (_, name, patch) => {
      const names = build({ ...full(), ...patch })
        .toJSON()
        .fields?.map((f) => f.name);
      expect(names).toHaveLength(3);
      expect(names).not.toContain(name);
    },
  );
});

describe('fitSectionLines — the 1024 boundary', () => {
  const tail = `[see all ↗](${ORIGIN}/games)`;

  it('keeps every line when the value is exactly 1024 chars', () => {
    const first = 'x'.repeat(
      DIGEST_EMBED_LIMITS.fieldValue - tail.length - 2 - 10,
    );
    const value = fitSectionLines(
      [first, 'y'.repeat(10)],
      2,
      `${ORIGIN}/games`,
    );
    expect(value).toHaveLength(DIGEST_EMBED_LIMITS.fieldValue);
    expect(value.endsWith(`\n${'y'.repeat(10)}\n${tail}`)).toBe(true);
  });

  it('drops the last line at 1025 and counts it in "+N more"', () => {
    const first = 'x'.repeat(
      DIGEST_EMBED_LIMITS.fieldValue - tail.length - 2 - 10,
    );
    const value = fitSectionLines(
      [first, 'y'.repeat(11)],
      2,
      `${ORIGIN}/games`,
    );
    expect(value).toBe(`${first}\n+1 more · ${tail}`);
  });

  it('counts items the data layer already cut (total > items)', () => {
    const fields = build({ ...full(), playing: playing(5, 12) }).toJSON()
      .fields;
    expect(fieldNamed(fields, DIGEST_FIELD_NAMES.playing)).toMatch(
      new RegExp(`\\n\\+7 more · \\[see all ↗\\]\\(${ORIGIN}/games\\)$`),
    );
  });

  it('fits 60 long-named LFG groups under 1024 with an accurate remainder', () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      lfgLine(`slug-${String(i)}`, { gameName: 'N'.repeat(90) }),
    );
    const value =
      fieldNamed(
        build({ ...full(), lfg: { items, total: 60 } }).toJSON().fields,
        DIGEST_FIELD_NAMES.lfg,
      ) ?? '';
    expect(value.length).toBeLessThanOrEqual(DIGEST_EMBED_LIMITS.fieldValue);
    const shown = value.split('\n').length - 1;
    expect(value).toContain(
      `+${String(60 - shown)} more · [see all ↗](${ORIGIN}/games?lfg=1)`,
    );
  });
});

describe('buildWeeklyDigestEmbed — Discord totals', () => {
  it('stays inside 25 fields, 256 title and 6000 total at the worst case', () => {
    const long = 'W'.repeat(400);
    const many = <T>(make: (i: number) => T) =>
      Array.from({ length: 80 }, (_, i) => make(i));
    const data = build({
      playing: {
        items: many((i) => ({
          gameId: i,
          name: long,
          slug: 's',
          playerCount: 9,
        })),
        total: 80,
      },
      recap: { eventsRun: 99999, playersAttended: 99999, attendances: 1 },
      deals: {
        items: many((i) => ({ ...deal(i, 9.99), name: long })),
        total: 80,
      },
      lfg: {
        items: many((i) => lfgLine(`s${String(i)}`, { gameName: long })),
        total: 80,
      },
    }).toJSON();
    expect(data.fields?.length).toBeLessThanOrEqual(DIGEST_EMBED_LIMITS.fields);
    expect(data.title?.length).toBeLessThanOrEqual(DIGEST_EMBED_LIMITS.title);
    data.fields?.forEach((f) =>
      expect(f.value.length).toBeLessThanOrEqual(1024),
    );
    expect(embedLength(data)).toBeLessThanOrEqual(DIGEST_EMBED_LIMITS.total);
  });
});

describe('buildWeeklyDigestEmbed — links', () => {
  it('strips a trailing slash from the configured origin', () => {
    const json = JSON.stringify(build(full(), `${ORIGIN}/`).toJSON());
    expect(json).not.toContain(`${ORIGIN}//`);
  });

  it('emits no link at all when no client URL is configured', () => {
    const data = build(full(), null).toJSON();
    expect(JSON.stringify(data)).not.toMatch(/\]\(|https?:/);
    expect(data.author?.url).toBeUndefined();
    expect(fieldNamed(data.fields, DIGEST_FIELD_NAMES.playing)).toBe(
      '**Game 1** · 1 player\n**Game 2** · 2 players',
    );
  });

  it('URL-encodes an LFG slug', () => {
    const fields = build({
      ...full(),
      lfg: { items: [lfgLine('a b')], total: 1 },
    }).toJSON().fields;
    expect(fieldNamed(fields, DIGEST_FIELD_NAMES.lfg)).toContain(
      `${ORIGIN}/lfg/a%20b)`,
    );
  });
});

describe('buildWeeklyDigestEmbed — privacy and mentions', () => {
  it('renders the recap as counts only — no member can be named', () => {
    const recap = fieldNamed(
      build(full()).toJSON().fields,
      DIGEST_FIELD_NAMES.recap,
    );
    expect(recap?.split('\n')[0]).toBe('**4** events · **9** players');
  });

  it('never carries a mention, even from a hostile game name', () => {
    const hostile = {
      ...full(),
      playing: {
        items: [
          { gameId: 1, name: '<@123> @everyone', slug: 's', playerCount: 2 },
        ],
        total: 1,
      },
    };
    const json = JSON.stringify(build(hostile).toJSON());
    expect(json).not.toContain('<@');
    expect(json).not.toContain('@everyone');
  });

  it('escapes masked-link and markdown characters in names and caps length', () => {
    expect(sanitizeName('[a](b) *c*')).toBe('\\[a\\]\\(b\\) \\*c\\*');
    expect(sanitizeName('z'.repeat(300))).toHaveLength(DIGEST_NAME_MAX);
  });

  it('is a channel embed that refuses a personalized field', () => {
    expect(() =>
      build(full()).addFields({
        name: '\u{1F3AE} In your library',
        value: 'x',
      }),
    ).toThrow('personalized field on channel embed');
  });
});
