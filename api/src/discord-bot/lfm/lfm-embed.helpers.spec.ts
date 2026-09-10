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
import {
  LFG_BOARD_TAGS,
  type LfgBoardTag,
} from '../lfg-board/lfg-board.constants';
import {
  buildLfmEmbed,
  lfmStateTag,
  type LfmEmbedOptions,
  type LfmGroupView,
  type LfmRenderState,
} from './lfm-embed.helpers';
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

  // ROK-1505 D6 — only the state word changes at one hand; the grammar is D7's.
  it('reads LOOKING with the shortfall at one hand (ROK-1505 D6)', () => {
    expect(
      render({ memberCount: 1, memberNames: ['Bosco'] }).author?.name,
    ).toBe('◌ LOOKING · 1 looking · needs 3 more');
  });

  it('reads LOOKING without a shortfall when the threshold is unknown', () => {
    expect(
      render({
        memberCount: 1,
        memberNames: ['Bosco'],
        viabilityThreshold: null,
      }).author?.name,
    ).toBe('◌ LOOKING · 1 looking');
  });

  it('never reads "needs 0 more" on a threshold-1 game at one hand', () => {
    expect(
      render({ memberCount: 1, memberNames: ['Bosco'], viabilityThreshold: 1 })
        .author?.name,
    ).toBe('◌ LOOKING · 1 looking');
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
    expect(
      render({ state: 'closed', memberCount: 1, memberNames: ['Bosco'] })
        .description,
    ).toBe(`**Bosco**\n[Open group ↗](${CLIENT_URL}/lfg/deep-rock-galactic)`);
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

/** The rendered payload with an EXPLICIT options object (ROK-1471 D7). */
function renderWith(
  options: LfmEmbedOptions,
  overrides: Partial<LfmGroupView> = {},
) {
  return buildLfmEmbed(group(overrides), CONTEXT, NOW, options).embed.data;
}

const ALL_STATES: LfmRenderState[] = ['open', 'scheduled', 'expired', 'closed'];
const TERMINAL_STATES: LfmRenderState[] = ['scheduled', 'expired', 'closed'];

/**
 * The chrome stamps `timestamp` from the WALL clock, so two renders a
 * millisecond apart differ by a field neither call site controls. Freezing the
 * clock is what lets the non-regression proof below stay a whole-payload deep
 * equality instead of being weakened to a field-by-field spot check.
 */
function withFrozenClock(): void {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterAll(() => {
    jest.useRealTimers();
  });
}

/**
 * ROK-1471 D7 / AC5(i) — the NON-REGRESSION proof. ROK-1454 owns every 3-arg
 * call site; the option is only safe if adding it changed nothing for them.
 * Deep equality on the whole API payload, not a spot-check on the description:
 * a fourth parameter that leaked into the author line or the footer would pass
 * a `toContain` and fail here.
 */
describe("buildLfmEmbed — linkStyle defaults to 'masked' (AC5 i)", () => {
  withFrozenClock();

  it.each(ALL_STATES)(
    'a 3-arg call renders byte-identically to an explicit masked call at %s',
    (state) => {
      expect(render({ state })).toEqual(
        renderWith({ linkStyle: 'masked' }, { state }),
      );
    },
  );

  it('an EMPTY options object is the same as no options object', () => {
    expect(render()).toEqual(renderWith({}));
  });
});

/**
 * AC5(ii)/(iv) — "the masked link only where there is no button row". The row
 * exists ONLY while open, so `'button'` must suppress the link only there; a
 * terminal render keeps its link or the archived thread ends up a dead end.
 */
describe("buildLfmEmbed — linkStyle 'button' (AC5 ii, iv)", () => {
  withFrozenClock();

  it('drops the masked group link while the group is open', () => {
    const data = renderWith({ linkStyle: 'button' });
    expect(data.description).not.toContain('Open group');
    expect(data.description).not.toContain(`${CLIENT_URL}/lfg/`);
    // The roster is NOT what the option suppresses.
    expect(data.description).toContain('Bosco');
  });

  it.each(TERMINAL_STATES)(
    'reverts to the masked render at %s — a terminal post has no button row',
    (state) => {
      expect(renderWith({ linkStyle: 'button' }, { state })).toEqual(
        renderWith({ linkStyle: 'masked' }, { state }),
      );
    },
  );

  it.each<LfmRenderState>(['scheduled', 'closed'])(
    'still carries the masked group link at %s',
    (state) => {
      expect(
        renderWith({ linkStyle: 'button' }, { state }).description,
      ).toContain(`${CLIENT_URL}/lfg/deep-rock-galactic`);
    },
  );

  // Ported from lane a2 (T10): without the group link the description is the
  // roster ALONE, so the `|| 'Nobody yet'` fallback is the only thing between a
  // rosterless render and an empty value Discord rejects outright.
  it("'button' keeps the empty-roster fallback Discord demands", () => {
    expect(
      renderWith({ linkStyle: 'button' }, { memberNames: [], memberCount: 0 })
        .description,
    ).toBe('Nobody yet');
  });

  // Ported from lane a2 (T10): the button row carries `/lfg/<slug>`; the event
  // link is a different destination, so dropping it would leave the terminal
  // render with no way to reach what the group actually became.
  it("'button' does NOT drop the SCHEDULED target link", () => {
    expect(
      renderWith(
        { linkStyle: 'button' },
        { state: 'scheduled', target: { kind: 'event', eventId: 55 } },
      ).description,
    ).toContain(`[Open event ↗](${CLIENT_URL}/events/55)`);
  });
});

/**
 * AC6 — the forum tag and the author line are the SAME vocabulary. Both sides
 * are asserted in one case so a state that renders one word and tags another
 * cannot pass: the tag must be a member of `LFG_BOARD_TAGS` AND appear verbatim
 * inside the author line the embed actually rendered.
 */
describe('lfmStateTag — the forum tag IS the author-line state (AC6)', () => {
  it.each<[string, Partial<LfmGroupView>, LfgBoardTag]>([
    ['open, below the threshold', { memberCount: 2 }, 'NEEDS PLAYERS'],
    // ROK-1505 D7 — one hand is LFG, not LFM: the chip's own word.
    ['open, one hand', { memberCount: 1, memberNames: ['Bosco'] }, 'LOOKING'],
    // D7 orders LOOKING BEFORE the viability check: a threshold-1 game is
    // "viable" at one hand and would otherwise read READY TO SCHEDULE with a
    // single player in the room.
    [
      'open, one hand on a threshold-1 game',
      { memberCount: 1, memberNames: ['Bosco'], viabilityThreshold: 1 },
      'LOOKING',
    ],
    [
      'open, at the threshold',
      { memberCount: 4, memberNames: ['Bosco', 'Karl', 'Doretta', 'Molly'] },
      'READY TO SCHEDULE',
    ],
    // Ported from lane a2: `deriveViability` is false without a threshold
    // however many turn up — a local `count >= n` shortcut would flip this.
    [
      'open, threshold unknown, however many turn up',
      { viabilityThreshold: null, memberCount: 99 },
      'NEEDS PLAYERS',
    ],
    ['scheduled', { state: 'scheduled' }, 'SCHEDULED'],
    // Ported from lane a2: terminal is terminal regardless of head-count.
    [
      'scheduled, still over the threshold',
      { state: 'scheduled', memberCount: 6 },
      'SCHEDULED',
    ],
    ['expired', { state: 'expired' }, 'EXPIRED'],
    ['closed', { state: 'closed' }, 'CLOSED'],
  ])('%s', (_label, overrides, expected) => {
    const tag = lfmStateTag(group(overrides));
    expect(tag).toBe(expected);
    expect(LFG_BOARD_TAGS).toContain(tag);
    expect(render(overrides).author?.name).toContain(tag);
  });
});

/**
 * ROK-1479 D9 / AC6 — urgency and expiry on the LFM embed.
 *
 * The constraint these cases exist to hold: `assertNoTimestampMarkup`
 * (`embeds/embed-chrome.helpers.ts`) THROWS if `<t:` reaches an author line or
 * a footer, because Discord renders the markup in a DESCRIPTION and in fields
 * but shows the literal token everywhere else. So the clock goes in the
 * description, the author line gets a plain `🔥 ` prefix, and the footer — which
 * would otherwise read `expires 17 Sep` on a 30-minute group — returns nothing.
 *
 * The absence assertions are deliberately assertions about the STRING, not
 * `expect(...).not.toThrow()`: the guard throwing is a crash on a real post,
 * and a test that only proves "it did not crash today" says nothing about the
 * copy a reader sees.
 */
const NOW_EXPIRES = '2026-09-10T12:30:00.000Z';
const NOW_EPOCH = String(Math.floor(Date.parse(NOW_EXPIRES) / 1000));

/** A group with one live `now` hand — `nowCount >= 1` is the whole definition. */
function nowGroup(
  overrides: Partial<LfmGroupView> = {},
): Partial<LfmGroupView> {
  return {
    urgency: 'now',
    nowCount: 1,
    soonestNowExpiresAt: NOW_EXPIRES,
    ...overrides,
  };
}

describe('buildLfmEmbed — ROK-1479 urgency (D9)', () => {
  it('leads the description with the now line and its <t:…:t> clock', () => {
    const description = render(nowGroup()).description ?? '';
    expect(
      description.startsWith(
        `🔥 1 wants to play now · until <t:${NOW_EPOCH}:t>`,
      ),
    ).toBe(true);
  });

  it('keeps the roster below the now line', () => {
    expect(render(nowGroup()).description).toBe(
      `🔥 1 wants to play now · until <t:${NOW_EPOCH}:t>\n` +
        '**Bosco** · **Karl**\n' +
        '[Open group ↗](https://raid.example/lfg/deep-rock-galactic)',
    );
  });

  it('drops the footer expiry entirely — a dated footer on a 30-minute group is a lie', () => {
    expect(render().footer?.text).toBe('Deep Rock · expires 17 Sep');
    expect(render(nowGroup()).footer?.text).toBe('Deep Rock');
  });

  // The author line carries NO 🔥: the description's now line already does,
  // and a now-group rendered two of them on one card (operator walk 2026-09-09).
  it('leaves the author line unprefixed and NEVER timestamped', () => {
    const name = render(nowGroup()).author?.name ?? '';
    expect(name).toBe('◌ NEEDS PLAYERS · 2 looking · needs 2 more');
    expect(name).not.toContain('🔥');
    expect(name).not.toContain('<t:');
  });

  // ROK-1505 AC8 — a single `Right now` hand renders the 🔥 line with the
  // "until" clock and no weekly footer. No code change was needed for this;
  // the fixture proves the one-hand post the story creates renders right.
  it('renders the now line and no weekly footer at ONE now hand (ROK-1505 AC8)', () => {
    const data = render(
      nowGroup({ memberCount: 1, memberNames: ['Bosco'], nowCount: 1 }),
    );
    expect(
      (data.description ?? '').startsWith(
        `🔥 1 wants to play now · until <t:${NOW_EPOCH}:t>`,
      ),
    ).toBe(true);
    expect(data.author?.name).toBe('◌ LOOKING · 1 looking · needs 3 more');
    expect(data.footer?.text).toBe('Deep Rock');
  });

  it('renders as now from ONE now hand in a mixed group', () => {
    const name = render(nowGroup({ nowCount: 1, memberCount: 4 })).author?.name;
    expect(name).toBe('▸ READY TO SCHEDULE · 4 looking');
  });

  it('states the urgency even when no now instant is readable', () => {
    const description =
      render(nowGroup({ soonestNowExpiresAt: null, expiresAt: null }))
        .description ?? '';
    expect(description.startsWith('🔥 1 wants to play now\n')).toBe(true);
    expect(description).not.toContain('<t:');
  });

  it.each(['scheduled', 'expired', 'closed'] as const)(
    'never renders the now line at %s — a terminal group has no clock left',
    (state) => {
      const data = render(nowGroup({ state }));
      expect(data.description ?? '').not.toContain('to play now');
      expect(data.author?.name ?? '').not.toContain('🔥');
    },
  );
});

/**
 * AC6's other half, and the regression that actually matters: a weekly group
 * must render EXACTLY as it did before ROK-1479. Asserted as a whole-payload
 * equality rather than field-by-field, so a stray key is a failure too.
 *
 * Verified by reverting: with `lfm-embed.helpers.ts` stashed back to its
 * pre-1479 state this case still passes, which is what "byte-identical" means.
 */
describe('buildLfmEmbed — ROK-1479 AC8: the weekly render is unchanged', () => {
  /**
   * The payload as it rendered on the pre-1479 tree, captured verbatim. Only
   * `timestamp` is loosened — the chrome stamps `new Date()` on every build, so
   * pinning it would fail once a second after it was written.
   */
  const WEEK_RENDER = {
    author: {
      icon_url: undefined,
      name: '◌ NEEDS PLAYERS · 2 looking · needs 2 more',
      url: undefined,
    },
    color: 16096779,
    description:
      '**Bosco** · **Karl**\n' +
      '[Open group ↗](https://raid.example/lfg/deep-rock-galactic)',
    footer: { icon_url: undefined, text: 'Deep Rock · expires 17 Sep' },
    thumbnail: { url: 'https://cdn.example/drg.png' },
    timestamp: expect.any(String) as unknown as string,
    title: 'Deep Rock Galactic',
    url: 'https://raid.example/games/12',
  };

  it('renders a weekly group exactly as before the story', () => {
    expect(render({ urgency: 'week', nowCount: 0 })).toEqual(WEEK_RENDER);
  });

  it('renders identically when the caller passes no urgency at all', () => {
    // Every ROK-1454 / ROK-1471 call site is this one: the fields are optional
    // and absent must mean weekly, or the whole existing fleet of posts moves.
    expect(render()).toEqual(WEEK_RENDER);
  });
});

/**
 * ROK-1494 D3 — the sixth render state.
 *
 * The high-risk assertions here, and why each exists:
 *
 *  - **the author line carries no clock.** `assertNoTimestampMarkup`
 *    (`embeds/embed-chrome.helpers.ts`) THROWS on `<t:` in an author line or a
 *    footer, and a `playing` group's only readable instant is its start — so
 *    the line is asserted verbatim AND scanned for the markup.
 *  - **colour by STATE.** `playing` is emerald (`live`) even though the group
 *    is past its open states, which is the one place `state !== 'open' =>
 *    done` had to be broken. Asserted against `colorForState('live')` rather
 *    than a literal, so a palette move cannot silently pass.
 *  - **both links.** A voice link with no event link (or vice versa) is the
 *    most likely half-implementation, so the description is asserted whole.
 */
describe('buildLfmEmbed — PLAYING NOW (ROK-1494 D3)', () => {
  const PLAYING: Partial<LfmGroupView> = {
    state: 'playing',
    memberCount: 3,
    memberNames: ['Bosco', 'Karl', 'Doretta'],
    playingEventId: 77,
    voiceChannelUrl: 'https://discord.com/channels/9001/2002',
  };

  it('leads the author line with PLAYING NOW and the voice head-count', () => {
    expect(render(PLAYING).author?.name).toBe('▸ PLAYING NOW · 3 in voice');
  });

  it('never puts timestamp markup in the author line or the footer', () => {
    const data = render({ ...PLAYING, expiresAt: '2026-09-10T13:00:00.000Z' });
    expect(data.author?.name).not.toContain('<t:');
    expect(data.footer?.text ?? '').not.toContain('<t:');
  });

  it('states no expiry in the footer — a live session has none left', () => {
    expect(render(PLAYING).footer?.text).toBe('Deep Rock');
  });

  it('renders emerald, the live colour, not the terminal slate', () => {
    expect(render(PLAYING).color).toBe(colorForState('live'));
  });

  it('carries the roster, the voice link and the event link', () => {
    expect(render(PLAYING).description).toBe(
      '**Bosco** · **Karl** · **Doretta**\n' +
        '[Join voice ↗](https://discord.com/channels/9001/2002)\n' +
        '[Open event ↗](https://raid.example/events/77)',
    );
  });

  it('still renders the roster when the voice channel is not up yet', () => {
    // The temp channel is created AFTER the spawn transaction commits, so a
    // render landing in that window has an event but no channel (D9).
    expect(render({ ...PLAYING, voiceChannelUrl: null }).description).toBe(
      '**Bosco** · **Karl** · **Doretta**\n' +
        '[Open event ↗](https://raid.example/events/77)',
    );
  });

  it('tags the post PLAYING NOW', () => {
    expect(lfmStateTag(group(PLAYING))).toBe('PLAYING NOW');
    expect(LFG_BOARD_TAGS).toContain('PLAYING NOW');
  });

  it('is not treated as a now-group — no 🔥 prefix, that is the open state', () => {
    expect(
      render({ ...PLAYING, nowCount: 3, urgency: 'now' }).author?.name,
    ).toBe('▸ PLAYING NOW · 3 in voice');
  });
});
