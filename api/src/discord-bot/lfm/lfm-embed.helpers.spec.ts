/**
 * ROK-1454 D7 — the LFM channel embed.
 *
 * The high-risk assertions here, and why each exists:
 *
 *  - **the empty-roster fallback.** `formatRoster` returns `''` for an empty
 *    roster and Discord REJECTS an empty value, so the `|| 'Nobody yet'` is a
 *    posting failure away, not a cosmetic default. Fed a genuinely empty
 *    roster, not a one-name one.
 *  - **colour by STATE, not by content.** A SCHEDULED group whose roster is
 *    still over the viability threshold must render slate (`done`), not
 *    emerald (`live`). The fixture is deliberately viable so a
 *    `isViable ? live : needs_you` shortcut that ignored the terminal state
 *    would go green and be caught.
 *  - **the poll link carries the MATCH id.** `lineupId` and `matchId` are
 *    given different values so putting either in the other's slot changes the
 *    URL. Route: `web/src/app-routes.tsx:125`.
 */
import {
  applyEmbedChrome,
  colorForState,
} from '../embeds/embed-chrome.helpers';
import {
  addPersonalizedFields,
  personalizedFieldName,
} from '../embeds/embed-personalized.helpers';
import { buildLfmEmbed, type LfmGroupView } from './lfm-embed.helpers';
import type { EmbedContext } from '../services/discord-embed.factory';

const CLIENT_URL = 'https://raid.example';
const NOW = Date.parse('2026-09-10T12:00:00.000Z');

const CONTEXT: EmbedContext = {
  communityName: 'Deep Rock',
  clientUrl: CLIENT_URL,
  timezone: 'UTC',
};

function group(overrides: Partial<LfmGroupView> = {}): LfmGroupView {
  return {
    state: 'open',
    gameId: 12,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    gameCoverUrl: 'https://cdn.example/drg.png',
    memberCount: 2,
    memberNames: ['Bosco', 'Karl'],
    viabilityThreshold: 4,
    expiresAt: '2026-09-17T23:30:00.000Z',
    ...overrides,
  };
}

/** The rendered embed's raw API payload. */
function render(overrides: Partial<LfmGroupView> = {}, context = CONTEXT) {
  return buildLfmEmbed(group(overrides), context, NOW).embed.data;
}

describe('buildLfmEmbed — author line (D7 vocabulary)', () => {
  it('names the shortfall while a known threshold is unmet', () => {
    expect(render().author?.name).toBe(
      '◌ NEEDS PLAYERS · 2 looking · needs 2 more',
    );
  });

  it('omits the shortfall when the threshold is unknown', () => {
    expect(render({ viabilityThreshold: null }).author?.name).toBe(
      '◌ NEEDS PLAYERS · 2 looking',
    );
  });

  it('flips to READY TO SCHEDULE once the threshold is met', () => {
    expect(
      render({
        memberCount: 4,
        memberNames: ['Bosco', 'Karl', 'Doretta', 'Molly'],
      }).author?.name,
    ).toBe('▸ READY TO SCHEDULE · 4 looking');
  });

  it.each([
    ['scheduled' as const, '■ SCHEDULED · 5 players'],
    ['expired' as const, '■ EXPIRED · 5 were looking'],
    ['closed' as const, '■ CLOSED · 5 still looking'],
  ])('reads the %s terminal line', (state, expected) => {
    expect(render({ state, memberCount: 5 }).author?.name).toBe(expected);
  });
});

describe('buildLfmEmbed — colour is chosen by STATE, never by content', () => {
  it('is amber while the group is not yet viable', () => {
    expect(render().color).toBe(colorForState('needs_you'));
  });

  it('is emerald once the group is viable', () => {
    expect(render({ memberCount: 4 }).color).toBe(colorForState('live'));
  });

  it('stays amber forever when the threshold is unknown (E9)', () => {
    // `deriveViability` is false forever without a threshold, so an unknown
    // co-op cap must NEVER read emerald however many people turn up. The
    // author-line assertions do not cover this half: a `chromeState` that
    // shortcut a null threshold straight to `live` passes every one of them.
    expect(render({ viabilityThreshold: null, memberCount: 99 }).color).toBe(
      colorForState('needs_you'),
    );
  });

  it.each(['scheduled', 'expired', 'closed'] as const)(
    'is slate at %s even with a viable roster',
    (state) => {
      // memberCount 6 >= threshold 4: content says "live", state says "done".
      expect(render({ state, memberCount: 6 }).color).toBe(
        colorForState('done'),
      );
    },
  );
});

describe('buildLfmEmbed — description', () => {
  it('falls back to "Nobody yet" rather than an empty value Discord rejects', () => {
    const description = render({ memberNames: [], memberCount: 0 }).description;

    expect(description).toBe(
      `Nobody yet\n[Open group ↗](${CLIENT_URL}/lfg/deep-rock-galactic)`,
    );
    expect(description).not.toContain('\n\n');
  });

  it('renders the bold roster above the group link while open', () => {
    expect(render().description).toBe(
      `**Bosco** · **Karl**\n[Open group ↗](${CLIENT_URL}/lfg/deep-rock-galactic)`,
    );
  });

  it('replaces the group link with the event at SCHEDULED', () => {
    const description = render({
      state: 'scheduled',
      target: { kind: 'event', eventId: 55 },
    }).description;

    expect(description).toContain(`[Open event ↗](${CLIENT_URL}/events/55)`);
    expect(description).not.toContain('/lfg/');
  });

  it('links a poll target by MATCH id, not by lineup or poll id', () => {
    const description = render({
      state: 'scheduled',
      target: { kind: 'poll', lineupId: 7, matchId: 99 },
    }).description;

    expect(description).toContain(
      `[Open poll ↗](${CLIENT_URL}/community-lineup/7/schedule/99)`,
    );
  });

  it('says nobody scheduled it at EXPIRED, with no roster and no link', () => {
    expect(render({ state: 'expired', memberCount: 5 }).description).toBe(
      'Nobody scheduled it.',
    );
  });

  it('still shows the survivors and the group link at CLOSED', () => {
    expect(render({ state: 'closed', memberCount: 1 }).description).toBe(
      `**Bosco** · **Karl**\n[Open group ↗](${CLIENT_URL}/lfg/deep-rock-galactic)`,
    );
  });

  it('drops the link entirely when no client URL is configured', () => {
    const description = buildLfmEmbed(
      group(),
      { communityName: 'Deep Rock', clientUrl: null, timezone: 'UTC' },
      NOW,
    ).embed.data.description;

    expect(description).toBe('**Bosco** · **Karl**');
  });
});

describe('buildLfmEmbed — title, thumbnail, fields, footer, content', () => {
  it('titles with the game name linked to its detail page', () => {
    const data = render();
    expect(data.title).toBe('Deep Rock Galactic');
    expect(data.url).toBe(`${CLIENT_URL}/games/12`);
  });

  it('thumbnails the cover art', () => {
    expect(render().thumbnail?.url).toBe('https://cdn.example/drg.png');
  });

  it('carries the co-op and price badges as inline fields while open', () => {
    const fields = render({
      badges: {
        cooptimusOnlineMax: 4,
        isFreeToPlay: false,
        itadCurrentCut: 50,
        itadCurrentPrice: '14.99',
        itadLowestPrice: '9.99',
      },
    }).fields;

    expect(fields?.map((f) => f.name)).toEqual(['👥 Co-op', '🏷 On Sale']);
    expect(fields?.every((f) => f.inline === true)).toBe(true);
  });

  it('thins the badges away at every terminal state', () => {
    for (const state of ['scheduled', 'expired', 'closed'] as const) {
      expect(
        render({ state, badges: { cooptimusOnlineMax: 4 } }).fields ?? [],
      ).toEqual([]);
    }
  });

  it('footers the expiry as plain text in the community timezone', () => {
    expect(render().footer?.text).toBe('Deep Rock · expires 17 Sep');
    expect(
      render({}, { ...CONTEXT, timezone: 'Australia/Sydney' }).footer?.text,
    ).toBe('Deep Rock · expires 18 Sep');
  });

  it('never ships Discord timestamp markup into the footer', () => {
    // `.not.toContain('<t:')` ALONE can never fail for its own reason: the
    // chrome rejects `<t:` at build time (`embed-chrome.helpers.ts:120`), so a
    // footer that grew a Unix timestamp would throw out of `render()` before
    // this matcher ever ran — the assertion would be decoration on someone
    // else's guard. Pin the build succeeding and the plain-date shape too, so
    // the regression fails HERE, by name.
    expect(() => render()).not.toThrow();
    expect(render().footer?.text).toMatch(/expires \d{1,2} [A-Z][a-z]{2}$/);
    expect(render().footer?.text).not.toContain('<t:');
  });

  it('drops the expiry footer at a terminal state — nothing expires any more', () => {
    expect(render({ state: 'scheduled' }).footer?.text).toBe('Deep Rock');
  });

  it('returns the first-post push line separately from the embed', () => {
    expect(buildLfmEmbed(group(), CONTEXT, NOW).content).toBe(
      '🔎 Deep Rock Galactic · 2 looking for a group',
    );
  });
});

describe('buildLfmEmbed — never renders a raw Discord mention (AC3)', () => {
  const EVERY_STATE: ReadonlyArray<[string, Partial<LfmGroupView>]> = [
    ['open', {}],
    [
      'scheduled (event)',
      { state: 'scheduled', target: { kind: 'event', eventId: 55 } },
    ],
    [
      'scheduled (poll)',
      {
        state: 'scheduled',
        target: { kind: 'poll', lineupId: 7, matchId: 99 },
      },
    ],
    ['expired', { state: 'expired', memberCount: 5 }],
    ['closed', { state: 'closed', memberCount: 1 }],
  ];

  it.each(EVERY_STATE)(
    'carries no <@ anywhere in the %s render',
    (_label, overrides) => {
      const { embed, content } = buildLfmEmbed(group(overrides), CONTEXT, NOW);

      // Whole-payload, not per-slot. The exact `toBe` assertions above pin only
      // the slots they name, so a mention added to an unpinned slot — a badge
      // value, or the SCHEDULED description — slips past every one of them.
      // Rosters render DISPLAY NAMES; a `<@id>` here pings the whole channel.
      expect(JSON.stringify(embed.data)).not.toContain('<@');
      expect(content).not.toContain('<@');
    },
  );
});

describe('buildLfmEmbed — no personalized fields, ever (AC4)', () => {
  it('refuses its own result at COMPILE time, and catches a forced one', () => {
    const { embed } = buildLfmEmbed(group(), CONTEXT, NOW);

    // @ts-expect-error — a ChannelEmbed is not assignable to DmEmbed. The call
    // only compiles because this directive forces it; that IS the guard. If
    // `buildLfmEmbed` ever stops returning a branded ChannelEmbed, tsc reports
    // "Unused '@ts-expect-error' directive" and this file stops compiling.
    // NOTE: ts-jest does not typecheck, so this half is only exercised by
    // `npx tsc --noEmit -p api/tsconfig.json` from the repo root.
    addPersonalizedFields(embed, [
      { kind: 'owned', name: personalizedFieldName('owned'), value: '142 hrs' },
    ]);

    // Forced past the type, the write-time half still refuses the result.
    expect(() =>
      applyEmbedChrome(embed, { surface: 'channel', state: 'needs_you' }),
    ).toThrow(/personalized field on channel embed/i);
  });
});
