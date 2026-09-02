/**
 * ROK-1447 — TDD pins for the compact Quick Play embed builder.
 *
 * `buildQuickPlayEmbed(data, context, state)` is the whole Quick Play family:
 * `'live'` while people are in voice, `'ended'` once the session closed. It
 * replaces the scheduled-event layout the ad-hoc path borrowed, which carried a
 * 📆 date line, a 🔊 voice line, a `── ROSTER: N signed up ──` header and a
 * button row — none of which survive here (spec §Shape).
 *
 * What this file pins, per `planning-artifacts/specs/ROK-1447.md`:
 *   AC1 materially smaller — ≤2 description lines + link at LIVE, ≤2 fields, no row
 *   AC2 title deep-links to `/games/:id`; `[Open event ↗]` links to the event
 *   AC3/AC4 the badge helpers decide the two inline fields; never a placeholder
 *   AC5 roster is bold names with `~~left~~` marks, capped at 6, zero `<@`
 *   AC6 degradation — no game / no ITAD / no Co-Optimus / no clientUrl
 *
 * Assertions read `embed.data` (the raw API payload) rather than any builder
 * internals, so a re-implementation that produces the same embed still passes.
 */
import { EMBED_COLORS } from '../discord-bot.constants';
import { PERSONALIZED_FIELD_NAMES } from '../embeds/embed-personalized.helpers';
import {
  buildEventPushContent,
  buildCompletedPushContent,
} from '../utils/push-content';
import { buildQuickPlayEmbed } from './discord-embed-quickplay.helpers';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';

const CLIENT_URL = 'https://rl.example';
const START = '2026-09-02T18:00:00Z';
/** 2h 45m after START — the ENDED author line reports exactly this. */
const END = '2026-09-02T20:45:00Z';
const START_UNIX = Math.floor(Date.parse(START) / 1000);
const END_UNIX = Math.floor(Date.parse(END) / 1000);
const COOP_FIELD = '\u{1F465} Co-op';
/**
 * The clock the price badge ages against, one hour after the fixture's price
 * check. Passed EXPLICITLY (review H1): the builder used to read `Date.now()`,
 * so the strict field pin below silently became a time bomb — it would have
 * started failing 24h after `START` when the staleness marker appeared.
 */
const NOW = Date.parse(START) + 3_600_000;
const DAY_MS = 86_400_000;

type Mention = NonNullable<EmbedEventData['signupMentions']>[number];
type Game = NonNullable<EmbedEventData['game']>;

const CONTEXT: EmbedContext = {
  communityName: 'Test Guild',
  clientUrl: CLIENT_URL,
  timezone: 'UTC',
};

/**
 * `resolveClientUrl`-style fallbacks read `process.env.CLIENT_URL`, so the
 * "no client URL configured" cases below have to see it genuinely absent.
 */
const ORIGINAL_CLIENT_URL = process.env.CLIENT_URL;

beforeEach(() => {
  delete process.env.CLIENT_URL;
});

afterAll(() => {
  if (ORIGINAL_CLIENT_URL === undefined) delete process.env.CLIENT_URL;
  else process.env.CLIENT_URL = ORIGINAL_CLIENT_URL;
});

/** One quick-play participant; `left: true` renders the struck-through form. */
function player(username: string, left = false): Mention {
  return {
    discordId: null,
    username,
    role: null,
    preferredRoles: null,
    ...(left ? { status: 'left' } : {}),
  };
}

/** A game with a live 50%-off deal and an online co-op claim. */
function fullGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 7,
    name: 'World of Warcraft',
    coverUrl: 'https://cdn.example/wow.jpg',
    badges: {
      isFreeToPlay: false,
      itadCurrentPrice: '29.99',
      itadCurrentCut: 50,
      itadCurrentShop: 'Steam',
      itadCurrentUrl: 'https://store.example/deal',
      itadLowestPrice: '14.99',
      itadPriceUpdatedAt: new Date(START),
      cooptimusOnlineMax: 4,
      cooptimusCouchMax: null,
      cooptimusComboCoop: null,
    },
    ...overrides,
  };
}

function event(overrides: Partial<EmbedEventData> = {}): EmbedEventData {
  return {
    id: 42,
    title: 'World of Warcraft — Quick Play',
    startTime: START,
    endTime: END,
    signupCount: 3,
    maxAttendees: null,
    slotConfig: { type: 'generic' },
    game: fullGame(),
    signupMentions: [player('Ana'), player('Bo'), player('Cy')],
    ...overrides,
  };
}

/** Non-empty description lines — blank spacers are layout, not content. */
function bodyLines(description: string | undefined): string[] {
  return (description ?? '').split('\n').filter((l) => l.trim().length > 0);
}

function fieldNames(fields: { name: string }[] | undefined): string[] {
  return (fields ?? []).map((f) => f.name);
}

describe('buildQuickPlayEmbed — chrome', () => {
  it('paints LIVE with the emerald live colour', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(embed.data.color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
  });

  it('paints ENDED with the slate done colour', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'ended');
    expect(embed.data.color).toBe(EMBED_COLORS.SYSTEM);
  });

  it('carries the state and the active head-count on the LIVE author line', () => {
    const data = event({
      signupMentions: [
        player('Ana'),
        player('Bo'),
        player('Cy'),
        player('Dee', true),
      ],
    });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.author?.name).toBe('▸ LIVE · Quick Play · 3 playing');
  });

  it('counts nobody as playing once every participant has left', () => {
    const data = event({
      signupMentions: [player('Ana', true), player('Bo', true)],
    });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.author?.name).toBe('▸ LIVE · Quick Play · 0 playing');
  });

  it('carries the session duration on the ENDED author line', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'ended');
    expect(embed.data.author?.name).toBe('■ ENDED · Quick Play · 2h 45m');
  });

  it('footers the community and the start time at LIVE', () => {
    // Codex review: Discord does NOT render `<t:…>` markdown inside a footer,
    // so the time is carried by the embed's native timestamp and the footer
    // text stays plain.
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(embed.data.footer?.text).toBe('Test Guild · started');
    expect(embed.data.timestamp).toBe(new Date(START).toISOString());
  });

  it('footers the community and the session window at ENDED', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'ended');
    const text = embed.data.footer?.text ?? '';
    expect(text.startsWith('Test Guild · ')).toBe(true);
    // Same window, rendered as plain wall-clock text in the context timezone
    // (UTC here) rather than as unrenderable footer markdown.
    expect(text).toContain('6:00');
    expect(text).toContain('8:45 PM');
    expect(text).toContain('–');
    expect(embed.data.timestamp).toBe(new Date(START).toISOString());
  });

  it.each(['live', 'ended'] as const)(
    'never ships an unrenderable timestamp token in the %s footer',
    (state) => {
      const { embed } = buildQuickPlayEmbed(event(), CONTEXT, state);
      const text = embed.data.footer?.text ?? '';
      expect(text).not.toContain('<t:');
      expect(text).not.toContain(`<t:${START_UNIX}`);
      expect(text).not.toContain(`<t:${END_UNIX}`);
    },
  );

  it('falls back to the default community name when none is configured', () => {
    const { embed } = buildQuickPlayEmbed(
      event(),
      { clientUrl: CLIENT_URL },
      'live',
    );
    expect(embed.data.footer?.text).toContain('Raid Ledger');
  });
});

describe('buildQuickPlayEmbed — title deep-links to the game (AC2)', () => {
  it('titles the embed with the bare game name', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(embed.data.title).toBe('World of Warcraft');
  });

  it('drops the 📅 glyph and the "— Quick Play" suffix from the title', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(embed.data.title).not.toContain('📅');
    expect(embed.data.title).not.toMatch(/quick play/i);
  });

  it('links the title to the game detail page', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(embed.data.url).toBe(`${CLIENT_URL}/games/7`);
  });

  it('keeps the game deep link at ENDED', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'ended');
    expect(embed.data.title).toBe('World of Warcraft');
    expect(embed.data.url).toBe(`${CLIENT_URL}/games/7`);
  });

  it('falls back to the unlinked event title when there is no game', () => {
    const { embed } = buildQuickPlayEmbed(
      event({ game: null }),
      CONTEXT,
      'live',
    );
    expect(embed.data.title).toBe('World of Warcraft — Quick Play');
    expect(embed.data.url).toBeUndefined();
  });

  it('leaves the title unlinked when the projection carries no game id', () => {
    const { embed } = buildQuickPlayEmbed(
      event({ game: { name: 'Deep Rock Galactic' } }),
      CONTEXT,
      'live',
    );
    expect(embed.data.title).toBe('Deep Rock Galactic');
    expect(embed.data.url).toBeUndefined();
  });
});

describe('buildQuickPlayEmbed — description (AC1, AC5)', () => {
  it('renders the roster as bold display names, never mentions', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(embed.data.description).toContain('**Ana**');
    expect(embed.data.description).toContain('**Bo**');
    expect(embed.data.description).not.toContain('<@');
  });

  it('strikes through a participant who left', () => {
    const data = event({ signupMentions: [player('Ana'), player('Bo', true)] });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.description).toContain('~~**Bo**~~');
    expect(embed.data.description).not.toContain('~~**Ana**~~');
  });

  it('un-strikes the ENDED roster — everyone left, so nobody stands out', () => {
    // Operator decision: at ENDED every participant has left by definition, so
    // striking them all through says nothing and is not what the design shows.
    // The strike is a LIVE-only signal: "in the session, but gone right now".
    const data = event({
      signupMentions: [player('Ana', true), player('Bo', true)],
    });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'ended');
    expect(embed.data.description).toContain('**Ana**');
    expect(embed.data.description).toContain('**Bo**');
    expect(embed.data.description).not.toContain('~~**Ana**~~');
    expect(embed.data.description).not.toContain('~~**Bo**~~');
  });

  it('carries no strike-through at all on the ENDED roster', () => {
    const data = event({
      signupMentions: [player('Ana'), player('Bo', true), player('Cy', true)],
    });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'ended');
    expect(embed.data.description).not.toContain('~~');
  });

  it('caps the roster at six names and collapses the rest', () => {
    const data = event({
      signupMentions: [
        'Ana',
        'Bo',
        'Cy',
        'Dee',
        'Eve',
        'Fay',
        'Gus',
        'Hal',
      ].map((n) => player(n)),
    });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.description).toContain('+2 more');
    expect(embed.data.description).not.toContain('**Gus**');
  });

  it('says "Nobody yet" rather than rendering an empty roster', () => {
    const data = event({ signupMentions: [], signupCount: 0 });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.description).toContain('Nobody yet');
  });

  it('closes the description with the masked event link', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    const description = embed.data.description ?? '';
    expect(description).toContain(`[Open event ↗](${CLIENT_URL}/events/42)`);
    expect(description.indexOf('**Ana**')).toBeLessThan(
      description.indexOf('Open event'),
    );
  });

  it('omits the event link entirely when no client URL is configured', () => {
    const { embed } = buildQuickPlayEmbed(
      event(),
      { communityName: 'Test Guild' },
      'live',
    );
    expect(embed.data.description).not.toContain('Open event');
    expect(embed.data.description).toContain('**Ana**');
  });

  it('spends at most two content lines at LIVE: roster then link', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(bodyLines(embed.data.description)).toHaveLength(2);
  });

  it('drops the 📆 date line and the 🔊 voice line', () => {
    const data = event({ voiceChannelId: 'voice-9' });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.description).not.toContain('📆');
    expect(embed.data.description).not.toContain('🔊');
    expect(embed.data.description).not.toContain('<#voice-9>');
  });

  it('drops the "── ROSTER: N signed up ──" header', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(embed.data.description).not.toContain('ROSTER');
    expect(embed.data.description).not.toContain('signed up');
  });

  it('reports attendance at ENDED and nowhere else', () => {
    const data = event({ signupCount: 4 });
    const live = buildQuickPlayEmbed(data, CONTEXT, 'live');
    const ended = buildQuickPlayEmbed(data, CONTEXT, 'ended');
    expect(ended.embed.data.description).toContain('Attendance · 4 players');
    expect(live.embed.data.description).not.toContain('Attendance');
  });

  it('spends at most three content lines at ENDED: roster, attendance, link', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'ended');
    expect(bodyLines(embed.data.description).length).toBeLessThanOrEqual(3);
  });
});

describe('buildQuickPlayEmbed — badge fields (AC3, AC4)', () => {
  it('renders the co-op and price badges inline at LIVE', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live', NOW);
    expect(embed.data.fields).toEqual([
      {
        name: COOP_FIELD,
        // ROK-1447 rework: the 👥 lives on the field NAME only.
        value: '4 online co-op',
        inline: true,
      },
      {
        name: '\u{1F3F7} On Sale',
        value: '[−50% · $29.99](https://store.example/deal)',
        inline: true,
      },
    ]);
  });

  it('ages the price badge against the clock it is given (AC4)', () => {
    // The staleness marker is the one badge output that depends on WHEN the
    // embed is rendered, so the builder has to expose the same seam the helper
    // does — otherwise this path is unreachable from the surface that renders it.
    const { embed } = buildQuickPlayEmbed(
      event(),
      CONTEXT,
      'live',
      NOW + 3 * DAY_MS,
    );
    const price = (embed.data.fields ?? []).find((f) =>
      f.name.includes('Sale'),
    );
    expect(price?.value).toContain('⚠ checked 3 days ago');
  });

  it('carries no staleness marker while the price check is fresh', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live', NOW);
    const price = (embed.data.fields ?? []).find((f) =>
      f.name.includes('Sale'),
    );
    expect(price?.value).not.toContain('checked');
  });

  it('falls back to the wall clock when no clock is supplied', () => {
    // Production calls the 3-arg form; it must still render a price badge.
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect(fieldNames(embed.data.fields)).toContain('\u{1F3F7} On Sale');
  });

  it('omits the co-op field when Co-Optimus has no claim', () => {
    const data = event({
      game: fullGame({
        badges: { ...fullGame().badges, cooptimusOnlineMax: null },
      }),
    });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(fieldNames(embed.data.fields)).not.toContain(COOP_FIELD);
    expect(embed.data.fields).toHaveLength(1);
  });

  it('omits the price field for a free-to-play game', () => {
    const data = event({
      game: fullGame({
        badges: { ...fullGame().badges, isFreeToPlay: true },
      }),
    });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(fieldNames(embed.data.fields)).toEqual([COOP_FIELD]);
  });

  it('adds no fields at all when neither badge has anything to say', () => {
    const data = event({ game: { id: 7, name: 'World of Warcraft' } });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.fields ?? []).toHaveLength(0);
  });

  it('never emits a placeholder in place of a missing badge', () => {
    const data = event({ game: { id: 7, name: 'World of Warcraft' } });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    const values = ((embed.data.fields ?? []) as { value: string }[]).map(
      (f) => f.value,
    );
    expect(values).not.toContain('—');
    expect(values).not.toContain('');
    expect(values).not.toContain('None');
  });

  it('drops BOTH badges at ENDED even when the data is there', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'ended');
    expect(embed.data.fields ?? []).toHaveLength(0);
  });

  it('never carries more than two fields', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    expect((embed.data.fields ?? []).length).toBeLessThanOrEqual(2);
  });
});

describe('buildQuickPlayEmbed — art, buttons and push content', () => {
  it('uses the game cover as the thumbnail in both states', () => {
    expect(
      buildQuickPlayEmbed(event(), CONTEXT, 'live').embed.data.thumbnail?.url,
    ).toBe('https://cdn.example/wow.jpg');
    expect(
      buildQuickPlayEmbed(event(), CONTEXT, 'ended').embed.data.thumbnail?.url,
    ).toBe('https://cdn.example/wow.jpg');
  });

  it('omits the thumbnail when the game has no cover', () => {
    const data = event({ game: { id: 7, name: 'World of Warcraft' } });
    const { embed } = buildQuickPlayEmbed(data, CONTEXT, 'live');
    expect(embed.data.thumbnail).toBeUndefined();
  });

  it('attaches no button row in either state', () => {
    expect(buildQuickPlayEmbed(event(), CONTEXT, 'live').row).toBeUndefined();
    expect(buildQuickPlayEmbed(event(), CONTEXT, 'ended').row).toBeUndefined();
  });

  it('leaves the LIVE push content exactly as the shared builder writes it', () => {
    const data = event();
    expect(buildQuickPlayEmbed(data, CONTEXT, 'live').content).toBe(
      buildEventPushContent(data, CONTEXT.timezone),
    );
  });

  it('leaves the ENDED push content exactly as the shared builder writes it', () => {
    const data = event();
    expect(buildQuickPlayEmbed(data, CONTEXT, 'ended').content).toBe(
      buildCompletedPushContent(data),
    );
  });
});

describe('buildQuickPlayEmbed — the channel surface stays impersonal', () => {
  it.each(['live', 'ended'] as const)(
    'emits no personalized field name at %s',
    (state) => {
      const { embed } = buildQuickPlayEmbed(event(), CONTEXT, state);
      for (const name of fieldNames(embed.data.fields)) {
        expect(PERSONALIZED_FIELD_NAMES.has(name)).toBe(false);
      }
    },
  );

  it('is a channel embed, so a personalized field is rejected at write time', () => {
    const { embed } = buildQuickPlayEmbed(event(), CONTEXT, 'live');
    const personalized = [...PERSONALIZED_FIELD_NAMES][0];
    expect(() =>
      embed.addFields({ name: personalized, value: 'yes' }),
    ).toThrow();
  });
});

describe('buildQuickPlayEmbed — degradation (AC6)', () => {
  const noItad = fullGame({
    badges: {
      ...fullGame().badges,
      itadCurrentPrice: null,
      itadCurrentCut: null,
      itadCurrentUrl: null,
      itadLowestPrice: null,
      itadPriceUpdatedAt: null,
    },
  });
  const noCoop = fullGame({
    badges: {
      ...fullGame().badges,
      cooptimusOnlineMax: null,
      cooptimusCouchMax: null,
      cooptimusComboCoop: null,
    },
  });

  const cases: Array<[string, EmbedEventData, EmbedContext]> = [
    ['no game at all', event({ game: null }), CONTEXT],
    ['no badge sub-object', event({ game: { id: 7, name: 'Game' } }), CONTEXT],
    ['no ITAD row', event({ game: noItad }), CONTEXT],
    ['no Co-Optimus row', event({ game: noCoop }), CONTEXT],
    ['no client URL', event(), { communityName: 'Test Guild' }],
    ['nothing configured', event({ game: null }), {}],
    ['no participants', event({ signupMentions: [], signupCount: 0 }), CONTEXT],
  ];

  it.each(cases)('renders %s without throwing at LIVE', (_n, data, ctx) => {
    expect(() => buildQuickPlayEmbed(data, ctx, 'live')).not.toThrow();
  });

  it.each(cases)('renders %s without throwing at ENDED', (_n, data, ctx) => {
    expect(() => buildQuickPlayEmbed(data, ctx, 'ended')).not.toThrow();
  });

  it.each(cases)('renders %s with no empty field or title', (_n, data, ctx) => {
    const { embed } = buildQuickPlayEmbed(data, ctx, 'live');
    expect(embed.data.title).toBeTruthy();
    expect(embed.data.description).toBeTruthy();
    for (const field of embed.data.fields ?? []) {
      expect(field.name.length).toBeGreaterThan(0);
      expect(field.value.length).toBeGreaterThan(0);
    }
  });
});
