/**
 * Unit tests for the weekly digest v2 render layer (ROK-1771 L5, spec §4).
 * Pins: the §4.1 field order; each section omitted when empty; the per-field
 * caps; a max-length digest within 6000 and the §4.2 trim order; no mention
 * from a hostile name through ANY line builder; week-over-week arrows; the
 * `🆕 new` tag; and Discord timestamps only in the Coming up value.
 */
import { embedLength, type APIEmbed } from 'discord.js';
import type { DigestBestPriceLine } from './weekly-digest-best-price.helpers';
import {
  DIGEST_FIELD_NAMES,
  milestonesField,
  recapField,
  upcomingField,
  weekArrow,
} from './weekly-digest-embed-sections.helpers';
import {
  spotlightField,
  spotlightFieldName,
} from './weekly-digest-embed-spotlight.helpers';
import {
  buildWeeklyDigestEmbed,
  renderDigestFields,
  type DigestSectionsV2,
} from './weekly-digest-embed.helpers';
import {
  DIGEST_EMBED_LIMITS,
  DIGEST_FIELD_CAPS,
  DIGEST_TRIM_STEPS,
  digestLinks,
  fitDigestTotal,
  type DigestTrimStep,
} from './weekly-digest-embed-text.helpers';
import type { DigestMilestones } from './weekly-digest-milestones.helpers';
import type { SpotlightCandidate } from './weekly-digest-spotlight.helpers';
import type { WeeklyUpcoming } from './weekly-digest-upcoming.helpers';

const ORIGIN = 'https://raid.example.test';
const KINDS = [
  'rising_game',
  'duo',
  'boss_kills',
  'common_ground',
  'marathon',
] as const;
const LINKS = digestLinks(ORIGIN);
const END = new Date('2026-10-12T12:00:00Z');
const UNIX = 1790000000;
const HOSTILE = '@everyone <@123> <@&5> @here **b** [x](y)';

const SPOTLIGHTS = {
  rising_game: {
    kind: 'rising_game',
    game: { gameId: 3, name: 'Helldivers 2' },
    hoursThisWeek: 31,
    hoursPriorWeek: 9,
    playerCount: 5,
  },
  duo: {
    kind: 'duo',
    members: [
      { userId: 1, name: 'Brightwing' },
      { userId: 2, name: 'Kael' },
    ],
    minutesTogether: 570,
    eventCount: 4,
    eventTitles: ['Molten Core', 'Dungeon night'],
  },
  boss_kills: {
    kind: 'boss_kills',
    instanceName: null,
    killCount: 8,
    firstEverKills: ['Ragnaros'],
  },
  common_ground: {
    kind: 'common_ground',
    lineupId: 9,
    winner: { gameId: 4, name: 'Valheim', votes: 9 },
    totalVotes: 17,
    runnerUp: { gameId: 5, name: 'Deep Rock Galactic', votes: 5 },
  },
  marathon: {
    kind: 'marathon',
    eventId: 12,
    eventTitle: 'Molten Core — Week 5',
    durationMinutes: 280,
    attendeeCount: 18,
  },
} satisfies Record<SpotlightCandidate['kind'], SpotlightCandidate>;

function milestones(): DigestMilestones {
  return {
    newMembers: { names: ['Mira', 'Tobias', 'Quill'], total: 3 },
    eventMilestones: [{ userId: 2, name: 'Kael', threshold: 25 }],
    firstGames: [{ gameId: 4, name: 'Valheim' }],
    hourMilestones: [{ gameId: 6, name: 'Deep Rock Galactic', threshold: 250 }],
  };
}

function upcoming(): WeeklyUpcoming {
  return {
    events: [
      {
        eventId: 21,
        title: 'Molten Core — Week 6',
        gameName: null,
        startsAt: new Date(UNIX * 1000),
        signupCount: 18,
      },
    ],
    polls: [
      {
        matchId: 7,
        lineupId: 9,
        gameName: 'Helldivers 2',
        deadline: null,
        memberCount: 5,
        openSlotCount: 2,
      },
    ],
  };
}

function priceLine(gameId: number, name = `Deal ${String(gameId)}`) {
  const line: DigestBestPriceLine = {
    gameId,
    name,
    slug: 's',
    cutPercent: 60,
    price: 11.99,
    wishlisters: 5,
  };
  return line;
}

function full(): DigestSectionsV2 {
  return {
    spotlight: SPOTLIGHTS.duo,
    playing: {
      items: [
        { gameId: 4, name: 'Valheim', slug: 'v', playerCount: 7 },
        { gameId: 1, name: 'World of Warcraft', slug: 'w', playerCount: 6 },
      ],
      total: 2,
    },
    newGameIds: [4],
    recap: { eventsRun: 6, playersAttended: 14, attendances: 30 },
    priorRecap: { eventsRun: 4, playersAttended: 15, attendances: 20 },
    milestones: milestones(),
    upcoming: upcoming(),
    lfg: {
      items: [
        {
          gameName: 'Lethal Company',
          gameSlug: 'lc',
          activeCount: 3,
          nowCount: 1,
          isViable: false,
          playersNeeded: 1,
        },
      ],
      total: 1,
    },
    bestPrice: { items: [priceLine(8, 'Deep Rock Galactic')], total: 1 },
  };
}

function build(sections: DigestSectionsV2): APIEmbed {
  const embed = buildWeeklyDigestEmbed({
    sections,
    clientUrl: ORIGIN,
    windowEnd: END,
  });
  if (!embed) throw new Error('expected an embed, got null');
  return embed.toJSON();
}

function valueOf(data: APIEmbed, name: string): string {
  const value = data.fields?.find((f) => f.name === name)?.value;
  if (value === undefined) throw new Error(`no field named ${name}`);
  return value;
}

const ORDER = [
  spotlightFieldName('duo'),
  DIGEST_FIELD_NAMES.playing,
  DIGEST_FIELD_NAMES.recap,
  DIGEST_FIELD_NAMES.milestones,
  DIGEST_FIELD_NAMES.upcoming,
  DIGEST_FIELD_NAMES.lfg,
  DIGEST_FIELD_NAMES.bestPrice,
] as const;

describe('weekly digest v2 — field order and empty sections', () => {
  it('renders the seven fields in the §4.1 order', () => {
    expect(build(full()).fields?.map((f) => f.name)).toEqual(ORDER);
  });

  it.each([
    ['spotlight', ORDER[0], { spotlight: null }],
    ['playing', ORDER[1], { playing: { items: [], total: 0 } }],
    ['recap', ORDER[2], { recap: null }],
    ['milestones (null)', ORDER[3], { milestones: null }],
    [
      'milestones (all lists empty)',
      ORDER[3],
      {
        milestones: {
          newMembers: { names: [], total: 0 },
          eventMilestones: [],
          firstGames: [],
          hourMilestones: [],
        },
      },
    ],
    ['upcoming (null)', ORDER[4], { upcoming: null }],
    ['upcoming (empty)', ORDER[4], { upcoming: { events: [], polls: [] } }],
    ['lfg', ORDER[5], { lfg: { items: [], total: 0 } }],
    ['best price', ORDER[6], { bestPrice: { items: [], total: 0 } }],
  ] as Array<[string, string, Partial<DigestSectionsV2>]>)(
    'omits the %s field when it is empty',
    (_, name, patch) => {
      const names = build({ ...full(), ...patch }).fields?.map((f) => f.name);
      expect(names).toHaveLength(6);
      expect(names).not.toContain(name);
    },
  );

  it('returns null only when every section is empty; Coming up alone posts (Q6)', () => {
    const none: DigestSectionsV2 = {
      spotlight: null,
      playing: { items: [], total: 0 },
      newGameIds: [],
      recap: null,
      priorRecap: null,
      milestones: null,
      upcoming: null,
      lfg: { items: [], total: 0 },
      bestPrice: null,
    };
    expect(
      buildWeeklyDigestEmbed({
        sections: none,
        clientUrl: null,
        windowEnd: END,
      }),
    ).toBeNull();
    const names = build({ ...none, upcoming: upcoming() }).fields?.map(
      (f) => f.name,
    );
    expect(names).toEqual([DIGEST_FIELD_NAMES.upcoming]);
  });
});

describe('weekly digest v2 — spotlight lines', () => {
  it.each([
    [
      'rising_game',
      `**[Helldivers 2](${ORIGIN}/games/3)** jumped to **31 h** this week (▲ **22 h**) across **5** players.`,
    ],
    [
      'duo',
      '**Brightwing** and **Kael** spent **9.5 h** together across **4** events.\nMolten Core, Dungeon night',
    ],
    ['boss_kills', '**8** bosses down. First-ever kill: **Ragnaros** 🎉'],
    [
      'common_ground',
      `The lineup picked **[Valheim](${ORIGIN}/games/4)** — **9** of **17** votes.\nRunner-up: **Deep Rock Galactic** (5).`,
    ],
    [
      'marathon',
      `**[Molten Core — Week 5](${ORIGIN}/events/12)** ran **4 h 40 m** with **18** players.`,
    ],
  ] as Array<[SpotlightCandidate['kind'], string]>)(
    'renders the %s spotlight',
    (kind, expected) => {
      expect(spotlightField(SPOTLIGHTS[kind], LINKS)).toEqual({
        name: spotlightFieldName(kind),
        value: expected,
        inline: false,
      });
    },
  );
});

describe('weekly digest v2 — section lines', () => {
  it('renders milestones in priority order', () => {
    expect(milestonesField(milestones())?.value).toBe(
      '👋 Welcome **Mira**, **Tobias** and **Quill** (3 new members)\n' +
        '🎉 **Kael** reached **25** events\n' +
        '🆕 First time the community played **Valheim**\n' +
        '⏱️ **Deep Rock Galactic** passed **250** community hours',
    );
  });

  it('collapses extra new members and holds the field to 5 lines', () => {
    const m = milestones();
    m.newMembers = { names: ['A', 'B'], total: 4 };
    m.firstGames = ['G1', 'G2', 'G3'].map((name, i) => ({ gameId: i, name }));
    const lines = milestonesField(m)?.value.split('\n') ?? [];
    expect(lines[0]).toBe('👋 Welcome **A**, **B** and 2 more (4 new members)');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('+2 more');
  });

  it('renders Coming up events then polls, with a Discord timestamp', () => {
    expect(upcomingField(upcoming(), LINKS)?.value).toBe(
      `**[Molten Core — Week 6](${ORIGIN}/events/21)** · <t:${String(UNIX)}:f> · 18 signed up\n` +
        `🗳️ **Helldivers 2** poll · 5 interested · [vote ↗](${ORIGIN}/community-lineup/9/schedule/7?src=discord)\n` +
        `[see all ↗](${ORIGIN}/events)`,
    );
  });

  it('caps Coming up at 5 events and 2 polls', () => {
    const u = upcoming();
    const [event] = u.events;
    const [poll] = u.polls;
    if (!event || !poll) throw new Error('fixture');
    u.events = Array.from({ length: 8 }, (_, i) => ({ ...event, eventId: i }));
    u.polls = Array.from({ length: 4 }, (_, i) => ({ ...poll, matchId: i }));
    const lines = upcomingField(u, null)?.value.split('\n') ?? [];
    expect(lines.filter((l) => l.includes('signed up'))).toHaveLength(5);
    expect(lines.filter((l) => l.startsWith('🗳️'))).toHaveLength(2);
    expect(lines.at(-1)).toBe('+5 more');
  });

  it('renders a Best price line per the operator ruling', () => {
    expect(valueOf(build(full()), DIGEST_FIELD_NAMES.bestPrice)).toBe(
      `**[Deep Rock Galactic](${ORIGIN}/games/8)** −60% · $11.99 · all-time low · 5 wishlisted\n` +
        `[see all ↗](${ORIGIN}/games)`,
    );
  });

  it('tags only the games in newGameIds with 🆕 new', () => {
    const [valheim, wow] = valueOf(
      build(full()),
      DIGEST_FIELD_NAMES.playing,
    ).split('\n');
    expect(valheim).toBe(
      `**[Valheim](${ORIGIN}/games/4)** · 7 players · 🆕 new`,
    );
    expect(wow).toBe(`**[World of Warcraft](${ORIGIN}/games/1)** · 6 players`);
  });
});

describe('weekly digest v2 — week-over-week arrows', () => {
  it.each([
    ['up', 6, 4, ' ▲2'],
    ['down', 13, 14, ' ▼1'],
    ['flat', 5, 5, ''],
    ['unknown', 5, null, ''],
  ] as Array<[string, number, number | null, string]>)(
    '%s',
    (_, current, prior, expected) => {
      expect(weekArrow(current, prior)).toBe(expected);
    },
  );

  it('renders arrows on the recap line', () => {
    const recap = { eventsRun: 6, playersAttended: 14, attendances: 1 };
    const prior = { eventsRun: 4, playersAttended: 15, attendances: 1 };
    expect(recapField(recap, prior, null)?.value).toBe(
      '**6** events ▲2 · **14** players ▼1',
    );
  });

  it.each([
    ['absent', null],
    ['empty', { eventsRun: 0, playersAttended: 0, attendances: 0 }],
  ])('shows no arrow when last week is %s (AC7)', (_, prior) => {
    const recap = { eventsRun: 6, playersAttended: 14, attendances: 1 };
    expect(recapField(recap, prior, null)?.value).toBe(
      '**6** events · **14** players',
    );
  });
});

describe('weekly digest v2 — Discord timestamps', () => {
  it('appear only in the Coming up value — never in chrome or other fields', () => {
    const data = build({ ...full(), spotlight: SPOTLIGHTS.marathon });
    expect(valueOf(data, DIGEST_FIELD_NAMES.upcoming)).toContain(
      `<t:${String(UNIX)}:f>`,
    );
    const others = (data.fields ?? []).filter(
      (f) => f.name !== DIGEST_FIELD_NAMES.upcoming,
    );
    expect(others.length).toBeGreaterThan(0);
    for (const f of others)
      expect(`${f.name}\n${f.value}`).not.toContain('<t:');
    const chrome = [
      data.title,
      data.description,
      data.footer?.text,
      data.author?.name,
    ].join('\n');
    expect(chrome).not.toContain('<t:');
  });
});

function hostileDigest(kind: SpotlightCandidate['kind']): DigestSectionsV2 {
  const spotlights: Record<SpotlightCandidate['kind'], SpotlightCandidate> = {
    rising_game: {
      ...SPOTLIGHTS.rising_game,
      game: { gameId: 3, name: HOSTILE },
    },
    duo: {
      ...SPOTLIGHTS.duo,
      members: [
        { userId: 1, name: HOSTILE },
        { userId: 2, name: HOSTILE },
      ],
      eventTitles: [HOSTILE, HOSTILE],
    },
    boss_kills: {
      ...SPOTLIGHTS.boss_kills,
      instanceName: HOSTILE,
      firstEverKills: [HOSTILE],
    },
    common_ground: {
      kind: 'common_ground',
      lineupId: 9,
      winner: { gameId: 4, name: HOSTILE, votes: 9 },
      totalVotes: 17,
      runnerUp: { gameId: 5, name: HOSTILE, votes: 5 },
    },
    marathon: { ...SPOTLIGHTS.marathon, eventTitle: HOSTILE },
  };
  const base = full();
  return {
    ...base,
    spotlight: spotlights[kind],
    playing: {
      items: [{ gameId: 4, name: HOSTILE, slug: 'v', playerCount: 2 }],
      total: 1,
    },
    milestones: {
      newMembers: { names: [HOSTILE, HOSTILE], total: 2 },
      eventMilestones: [{ userId: 2, name: HOSTILE, threshold: 10 }],
      firstGames: [{ gameId: 4, name: HOSTILE }],
      hourMilestones: [{ gameId: 6, name: HOSTILE, threshold: 100 }],
    },
    upcoming: {
      events: upcoming().events.map((e) => ({ ...e, title: HOSTILE })),
      polls: upcoming().polls.map((p) => ({ ...p, gameName: HOSTILE })),
    },
    lfg: {
      items: base.lfg.items.map((l) => ({ ...l, gameName: HOSTILE })),
      total: 1,
    },
    bestPrice: { items: [priceLine(8, HOSTILE)], total: 1 },
  };
}

describe('weekly digest v2 — no mentions from hostile names (AC11)', () => {
  it.each(KINDS)(
    'through every line builder, with the %s spotlight',
    (kind) => {
      const data = build(hostileDigest(kind));
      expect(data.fields).toHaveLength(7);
      for (const f of data.fields ?? []) {
        expect(f.value).not.toMatch(/<@|<@&|@everyone|@here/);
        expect(f.value).not.toContain('[x](y)');
        expect(f.value).not.toMatch(/(^|[^\\])\*\*b\*\*/);
      }
    },
  );
});

const huge = '*'.repeat(400);
function maxDigest(): DigestSectionsV2 {
  const base = hostileDigest('duo');
  const many = <T>(n: number, make: (i: number) => T) =>
    Array.from({ length: n }, (_, i) => make(i));
  const ev = must(upcoming().events[0]);
  const poll = must(upcoming().polls[0]);
  return {
    ...base,
    spotlight: {
      ...SPOTLIGHTS.duo,
      members: [
        { userId: 1, name: huge },
        { userId: 2, name: huge },
      ],
      eventTitles: many(10, () => huge),
    },
    playing: {
      items: many(5, (i) => ({
        gameId: i,
        name: huge,
        slug: 's',
        playerCount: 9,
      })),
      total: 80,
    },
    newGameIds: many(5, (i) => i),
    milestones: {
      newMembers: { names: many(5, () => huge), total: 40 },
      eventMilestones: many(5, (i) => ({
        userId: i,
        name: huge,
        threshold: 50,
      })),
      firstGames: many(5, (i) => ({ gameId: i, name: huge })),
      hourMilestones: many(5, (i) => ({
        gameId: i,
        name: huge,
        threshold: 1000,
      })),
    },
    upcoming: {
      events: many(10, (i) => ({ ...ev, eventId: i, title: huge })),
      polls: many(5, (i) => ({ ...poll, matchId: i, gameName: huge })),
    },
    lfg: {
      items: many(80, (i) => ({
        ...must(base.lfg.items[0]),
        gameName: huge,
        gameSlug: `s${String(i)}`,
      })),
      total: 80,
    },
    bestPrice: { items: many(3, (i) => priceLine(i, huge)), total: 80 },
  };
}

describe('weekly digest v2 — per-field caps and the 6000 budget', () => {
  it('gives Coming up an 850 cap so 5 linked events and 2 polls fit', () => {
    expect(DIGEST_FIELD_CAPS.upcoming).toBe(850);
  });

  it('keeps every field under its §4.1 cap and the embed within 6000', () => {
    const data = build(maxDigest());
    const caps: Record<string, number> = {
      [spotlightFieldName('duo')]: DIGEST_FIELD_CAPS.spotlight,
      [DIGEST_FIELD_NAMES.playing]: DIGEST_FIELD_CAPS.playing,
      [DIGEST_FIELD_NAMES.recap]: DIGEST_FIELD_CAPS.recap,
      [DIGEST_FIELD_NAMES.milestones]: DIGEST_FIELD_CAPS.milestones,
      [DIGEST_FIELD_NAMES.upcoming]: DIGEST_FIELD_CAPS.upcoming,
      [DIGEST_FIELD_NAMES.lfg]: DIGEST_FIELD_CAPS.lfg,
      [DIGEST_FIELD_NAMES.bestPrice]: DIGEST_FIELD_CAPS.bestPrice,
    };
    expect(data.fields?.map((f) => f.name)).toEqual(ORDER);
    for (const f of data.fields ?? []) {
      expect(f.value.length).toBeGreaterThan(0);
      expect(f.value.length).toBeLessThanOrEqual(caps[f.name] ?? 0);
    }
    expect(embedLength(data)).toBeLessThanOrEqual(DIGEST_EMBED_LIMITS.total);
  });
});

describe('weekly digest v2 — §4.2 trim order', () => {
  it('fitDigestTotal applies the §4.2 trims in order and stops once it fits', () => {
    const seen: string[][] = [];
    const fields = fitDigestTotal(
      (applied) => {
        seen.push([...applied]);
        return [{ name: 'x', value: 'y'.repeat(1000 - applied.size * 100) }];
      },
      DIGEST_EMBED_LIMITS.total - 1001 + 300,
    );
    expect(seen).toEqual([
      [],
      ['dropBestPrice'],
      ['dropBestPrice', 'milestonesToThree'],
      ['dropBestPrice', 'milestonesToThree', 'lfgToThree'],
    ]);
    expect(fields[0]?.value).toHaveLength(700);
  });

  it('runs every trim, in the §4.2 order, when nothing fits', () => {
    const seen: string[][] = [];
    fitDigestTotal((applied) => {
      seen.push([...applied]);
      return [{ name: 'x', value: 'y' }];
    }, DIGEST_EMBED_LIMITS.total + 1);
    expect(seen.at(-1)).toEqual([
      'dropBestPrice',
      'milestonesToThree',
      'lfgToThree',
      'dropPolls',
      'stripPlayingLinks',
    ]);
    expect(DIGEST_TRIM_STEPS).toEqual(seen.at(-1));
  });
});

describe('weekly digest v2 — §4.2 trim effects', () => {
  it('each trim does what §4.2 says and never touches spotlight or recap', () => {
    const s = full();
    const lfg = must(s.lfg.items[0]);
    s.lfg = {
      items: Array.from({ length: 6 }, (_, i) => ({
        ...lfg,
        gameSlug: `g${String(i)}`,
      })),
      total: 6,
    };
    s.milestones = {
      ...milestones(),
      firstGames: ['G1', 'G2', 'G3'].map((name, i) => ({ gameId: i, name })),
    };
    const base = renderDigestFields(s, LINKS);
    const all = new Set<DigestTrimStep>(DIGEST_TRIM_STEPS);
    const trimmed = renderDigestFields(s, LINKS, all);
    const get = (fs: typeof base, n: string) =>
      fs.find((f) => f.name === n)?.value;
    expect(get(trimmed, DIGEST_FIELD_NAMES.bestPrice)).toBeUndefined();
    expect(
      get(trimmed, DIGEST_FIELD_NAMES.milestones)?.split('\n'),
    ).toHaveLength(3);
    expect(get(trimmed, DIGEST_FIELD_NAMES.lfg)?.split('\n')).toHaveLength(4);
    expect(get(trimmed, DIGEST_FIELD_NAMES.upcoming)).not.toContain('🗳️');
    expect(get(trimmed, DIGEST_FIELD_NAMES.playing)).not.toContain('](');
    expect(get(trimmed, DIGEST_FIELD_NAMES.playing)).toContain('**Valheim**');
    for (const name of [ORDER[0], DIGEST_FIELD_NAMES.recap]) {
      expect(get(base, name)).toBeDefined();
      expect(get(trimmed, name)).toBe(get(base, name));
    }
  });
});

function must<T>(value: T | undefined, label = 'fixture'): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}
