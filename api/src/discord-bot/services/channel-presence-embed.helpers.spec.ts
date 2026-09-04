/**
 * ROK-1446 (Lane A) — TDD pins for the channel-presence LIVE render.
 *
 * `buildChannelPresenceEmbeds(room, ctx, now, openedAt)` turns one `ResolvedRoom`
 * into the embed array of the single message a bound `general-lobby` voice
 * channel owns: a grey lead embed plus one embed per detected game group.
 *
 * The table below walks the FOUR live design renders (spec §Design reference,
 * `planning-artifacts/design-embed-system-2026-09-01.txt`). The fifth —
 * "Session ended" — belongs to `buildRecapEmbeds`, which this spawn deliberately
 * does not build.
 *
 * Reconciliation traps this file pins deliberately (spec §Design reference
 * reconciliation — the design PROSE is wrong in all five, the table binds):
 *   1. rosters are bold plain names, never `<@id>` mentions
 *   2. no button row ever — links are the title URL and the masked link
 *   3. the lead embed is present even with a single group
 *   4. …and even for Just Chatting
 *   5. a short group carries NO `[Open event ↗]`, contra the mixed-room mock
 *
 * Lead note 2026-09-04: `embed-colors.guard.spec.ts`'s `RAW_MENTION_RE` only
 * walks `discord-bot/embeds/`, so NOTHING automatically stops a `<@id>` leaking
 * into these rosters. The `no <@` assertions here are the only enforcement.
 *
 * Assertions read `embed.data` (the raw API payload), never builder internals.
 */
import { EMBED_COLORS } from '../discord-bot.constants';
import {
  buildChannelPresenceEmbeds,
  buildShortGroupEmbed,
  JUST_CHATTING_TITLE,
  MAX_GROUP_EMBEDS,
  type RenderableGroup,
} from './channel-presence-embed.helpers';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import type { ResolvedRoom, RoomGroup } from './channel-presence-room.helpers';

const CLIENT_URL = 'https://rl.example';
const START = '2026-09-02T18:00:00Z';
const END = '2026-09-02T20:45:00Z';
const NOW = Date.parse(START) + 3_600_000;
const OPENED_AT = new Date('2026-09-02T17:30:00Z');

const CONTEXT: EmbedContext = {
  communityName: 'Gamer Saloon',
  clientUrl: CLIENT_URL,
  timezone: 'UTC',
};

/** An ad-hoc event projection shaped like `buildEmbedEventData`'s output. */
function eventData(
  id: number,
  gameId: number | null,
  gameName: string,
  names: string[],
): EmbedEventData {
  return {
    id,
    title: `${gameName} — Quick Play`,
    startTime: START,
    endTime: END,
    signupCount: names.length,
    signupMentions: names.map((name) => ({
      displayName: name,
      role: null,
      preferredRoles: null,
      status: 'confirmed',
    })),
    ...(gameId === null ? {} : { game: { id: gameId, name: gameName } }),
  };
}

/** A group with a live linked event — renders through `buildQuickPlayEmbed`. */
function evented(
  gameId: number | null,
  gameName: string,
  names: string[],
  eventId = 900 + names.length,
): RoomGroup {
  return {
    gameId,
    gameName,
    memberIds: names.map((n) => `u-${n}`),
    memberNames: names,
    qualifying: true,
    eventId,
    eventData: eventData(eventId, gameId, gameName, names),
    game: null,
  };
}

/** A group below `minPlayers` with no event — renders amber. */
function short(
  gameId: number | null,
  gameName: string,
  names: string[],
): RoomGroup {
  return {
    gameId,
    gameName,
    memberIds: names.map((n) => `u-${n}`),
    memberNames: names,
    qualifying: false,
    eventId: null,
    eventData: null,
    game: null,
  };
}

function room(overrides: Partial<ResolvedRoom> = {}): ResolvedRoom {
  return {
    channelId: 'vc-1',
    channelName: 'General',
    memberCount: 3,
    minPlayers: 2,
    groups: [],
    undetectedNames: [],
    ...overrides,
  };
}

function render(r: ResolvedRoom) {
  return buildChannelPresenceEmbeds(r, CONTEXT, NOW, OPENED_AT).map(
    (e) => e.data,
  );
}

const COD = 'Call of Duty 4: Modern Warfare';

describe('buildChannelPresenceEmbeds — render 1: single game, threshold met', () => {
  const subject = room({
    memberCount: 3,
    groups: [evented(7, COD, ['hiphoptobop', 'roknua', 'vex'])],
  });

  it('keeps the lead embed even with a single group (trap 3)', () => {
    const embeds = render(subject);
    expect(embeds).toHaveLength(2);
    expect(embeds[0].title).toBe('\u{1F50A} General · 3 in voice');
    expect(embeds[0].color).toBe(EMBED_COLORS.SYSTEM);
  });

  it('says everyone is on the same game and stamps the row open time', () => {
    const [lead] = render(subject);
    expect(lead.description).toBe('Everyone here is on the same game.');
    expect(lead.timestamp).toBe(OPENED_AT.toISOString());
    expect(lead.fields ?? []).toHaveLength(0);
    expect(lead.url).toBeUndefined();
  });

  it('renders the evented group through the shipped Quick Play builder', () => {
    const [, group] = render(subject);
    expect(group.author?.name).toBe('▸ LIVE · Quick Play · 3 playing');
    expect(group.color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
    expect(group.title).toBe(COD);
    expect(group.url).toBe(`${CLIENT_URL}/games/7`);
    expect(group.description).toContain('**hiphoptobop**');
    expect(group.description).toContain(
      `[Open event ↗](${CLIENT_URL}/events/903)`,
    );
  });
});

describe('buildChannelPresenceEmbeds — render 2: two qualifying groups', () => {
  const subject = room({
    memberCount: 5,
    groups: [
      evented(7, COD, ['hiphoptobop', 'roknua', 'vex']),
      evented(11, 'Deep Rock Galactic', ['morrow', 'tinnitus']),
    ],
  });

  it('emits one embed per group behind the lead', () => {
    const embeds = render(subject);
    expect(embeds).toHaveLength(3);
    expect(embeds[0].description).toBe('2 sessions running.');
    expect(embeds[1].title).toBe(COD);
    expect(embeds[2].title).toBe('Deep Rock Galactic');
  });

  it('preserves the order resolveRoom already sorted into', () => {
    const reversed = room({
      memberCount: 5,
      groups: [
        evented(11, 'Deep Rock Galactic', ['morrow', 'tinnitus']),
        evented(7, COD, ['hiphoptobop', 'roknua', 'vex']),
      ],
    });
    expect(render(reversed).map((e) => e.title)).toEqual([
      '\u{1F50A} General · 5 in voice',
      'Deep Rock Galactic',
      COD,
    ]);
  });
});

describe('buildChannelPresenceEmbeds — render 3: mixed room', () => {
  const subject = room({
    memberCount: 5,
    groups: [
      evented(7, COD, ['hiphoptobop', 'roknua']),
      short(4, 'Valheim', ['morrow']),
    ],
    undetectedNames: ['tinnitus', 'vex'],
  });

  it('lists undetected members on the lead embed as bold names, not a roster', () => {
    const [lead] = render(subject);
    const field = (lead.fields ?? [])[0];
    expect(field?.name).toBe('In channel · no game detected');
    expect(field?.value).toBe('**tinnitus** · **vex**');
  });

  it('paints the short group amber and says how many more are needed', () => {
    const [, , amber] = render(subject);
    expect(amber.author?.name).toBe('◌ NEEDS 1 MORE');
    expect(amber.color).toBe(EMBED_COLORS.REMINDER);
    expect(amber.title).toBe('Valheim');
    expect(amber.url).toBe(`${CLIENT_URL}/games/4`);
    expect(amber.description).toBe('**morrow**');
  });

  it('gives the short group no event link and no signup language (trap 5)', () => {
    const [, , amber] = render(subject);
    expect(amber.description).not.toContain('Open event');
    expect(amber.description).not.toContain('signed up');
    expect(amber.timestamp).toBeUndefined();
  });
});

describe('buildChannelPresenceEmbeds — render 4: Just Chatting', () => {
  const subject = room({
    memberCount: 3,
    groups: [evented(null, 'Just Chatting', ['roknua', 'morrow', 'vex'], 950)],
  });

  it('keeps the lead embed and reports one running session (trap 4)', () => {
    const embeds = render(subject);
    expect(embeds).toHaveLength(2);
    expect(embeds[0].description).toBe('1 session running.');
  });

  it('counts the members as "in voice", never as "playing"', () => {
    const [, group] = render(subject);
    expect(group.author?.name).toBe('▸ LIVE · Quick Play · 3 in voice');
  });

  // Mutation M7 caught this test being vacuous: the fixture below used to carry
  // no `game` at all, so "drops the game" proved nothing. A Just Chatting group
  // matches a null-`game_id` event, so today its projection genuinely has no
  // game — but D2 states the requirement unconditionally, so the fixture is
  // adversarial on purpose: it hands the renderer game art and demands it be
  // stripped anyway.
  it('drops the game title, its URL, the thumbnail and the badges', () => {
    const chatting = evented(null, 'Just Chatting', ['roknua', 'morrow'], 951);
    chatting.eventData = {
      ...(chatting.eventData as EmbedEventData),
      game: {
        id: 7,
        name: COD,
        coverUrl: 'https://cdn.example/cod.png',
        badges: { cooptimusOnlineMax: 16 },
      },
    };
    const [, group] = render(room({ memberCount: 2, groups: [chatting] }));
    expect(group.title).toBe(JUST_CHATTING_TITLE);
    expect(group.url).toBeUndefined();
    expect(group.thumbnail).toBeUndefined();
    expect(group.fields ?? []).toHaveLength(0);
  });

  it('still renders bare when the linked event carries no game at all', () => {
    const [, group] = render(subject);
    expect(group.title).toBe(JUST_CHATTING_TITLE);
    expect(group.url).toBeUndefined();
    expect(group.thumbnail).toBeUndefined();
  });

  it('renders a short Just Chatting group amber under the same title', () => {
    const [, group] = render(
      room({
        memberCount: 1,
        groups: [short(null, 'Just Chatting', ['roknua'])],
      }),
    );
    expect(group.title).toBe(JUST_CHATTING_TITLE);
    expect(group.author?.name).toBe('◌ NEEDS 1 MORE');
    expect(group.url).toBeUndefined();
  });
});

describe('buildChannelPresenceEmbeds — rosters are names, never mentions', () => {
  it('never emits a raw mention in any slot of any render', () => {
    const subject = room({
      memberCount: 4,
      groups: [
        evented(7, COD, ['<@123456789012345678>', 'roknua']),
        short(4, 'Valheim', ['<@!987654321098765432>']),
      ],
      undetectedNames: ['<@&555>'],
    });
    const serialized = JSON.stringify(render(subject));
    expect(serialized).not.toContain('<@');
  });

  it('caps each roster at six names and collapses the rest', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const [, group] = render(
      room({ memberCount: 8, groups: [short(4, 'Valheim', names)] }),
    );
    expect(group.description).toBe(
      '**a** · **b** · **c** · **d** · **e** · **f** +2 more',
    );
  });
});

describe('buildChannelPresenceEmbeds — lead embed copy', () => {
  it('falls back to a generic channel name when the channel is gone', () => {
    const [lead] = render(room({ channelName: null, memberCount: 2 }));
    expect(lead.title).toBe('\u{1F50A} Voice channel · 2 in voice');
  });

  it('reports no tracked game when nothing is evented', () => {
    const [lead] = render(
      room({ memberCount: 2, groups: [short(4, 'Valheim', ['morrow'])] }),
    );
    expect(lead.description).toBe('Nobody on a tracked game yet.');
  });

  it('does not claim a shared game when undetected members are present', () => {
    const [lead] = render(
      room({
        memberCount: 4,
        groups: [evented(7, COD, ['a', 'b', 'c'])],
        undetectedNames: ['vex'],
      }),
    );
    expect(lead.description).toBe('1 session running.');
  });
});

describe('buildChannelPresenceEmbeds — Discord limits', () => {
  it('never exceeds ten embeds and names the overflow on the lead', () => {
    const groups = Array.from({ length: 12 }, (_, i) =>
      short(100 + i, `Game ${String(i).padStart(2, '0')}`, [`p${i}`]),
    );
    const embeds = render(room({ memberCount: 12, groups }));
    expect(embeds).toHaveLength(MAX_GROUP_EMBEDS + 1);
    const overflow = (embeds[0].fields ?? []).find((f) =>
      f.name.includes('more groups'),
    );
    expect(overflow?.name).toBe('+3 more groups');
    expect(overflow?.value).toBe('**Game 09** · **Game 10** · **Game 11**');
  });

  it('keeps the undetected field alongside the overflow field', () => {
    const groups = Array.from({ length: 10 }, (_, i) =>
      short(100 + i, `Game ${i}`, [`p${i}`]),
    );
    const [lead] = render(
      room({ memberCount: 11, groups, undetectedNames: ['vex'] }),
    );
    expect((lead.fields ?? []).map((f) => f.name)).toEqual([
      'In channel · no game detected',
      '+1 more groups',
    ]);
  });
});

describe('buildChannelPresenceEmbeds — evented is decided by the event, not the threshold', () => {
  it('renders a below-threshold group that still owns a live event as LIVE', () => {
    const outlived: RoomGroup = {
      ...evented(7, COD, ['roknua'], 941),
      qualifying: false,
    };
    const group = renderGroup(outlived);
    expect(group.color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
    expect(group.author?.name).toBe('▸ LIVE · Quick Play · 1 playing');
  });
});

describe('buildShortGroupEmbed — optional cover art and badges', () => {
  it('renders the co-op badge and the thumbnail when the group carries them', () => {
    const group: RenderableGroup = {
      ...short(4, 'Valheim', ['morrow']),
      game: {
        coverUrl: 'https://cdn.example/vh.png',
        badges: { cooptimusOnlineMax: 10 },
      },
    };
    const embed = buildShortGroupEmbed(
      group,
      room({ minPlayers: 2 }),
      CONTEXT,
      NOW,
    ).data;
    expect(embed.thumbnail?.url).toBe('https://cdn.example/vh.png');
    expect((embed.fields ?? []).map((f) => f.name)).toEqual([
      '\u{1F465} Co-op',
    ]);
  });

  it('omits both when the group carries neither', () => {
    const embed = buildShortGroupEmbed(
      short(4, 'Valheim', ['morrow']),
      room({ minPlayers: 2 }),
      CONTEXT,
      NOW,
    ).data;
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.fields ?? []).toHaveLength(0);
  });
});

// `qualifying` (the threshold verdict) and `eventData` (an ad-hoc event exists)
// are INDEPENDENT facts, so there are four combinations. D2 defines three of
// them. The fourth — qualifying with no event yet — was never enumerated, and is
// the state of EVERY new session for its first `SPAWN_DELAY_MS` (15 minutes,
// `voice-state-join-dispatch.handlers.ts:33`). It used to fall into the short
// branch, where `minPlayers - members` went negative and `Math.max(1, …)` turned
// it back into `◌ NEEDS 1 MORE` above a roster that had already cleared the
// threshold (review F-1).

/** Qualifying but not yet evented — the 15-minute spawn-delay window. */
function qualifyingNoEvent(
  gameId: number | null,
  gameName: string,
  names: string[],
): RoomGroup {
  return { ...short(gameId, gameName, names), qualifying: true };
}

/** Render one group as the only group in its room, and return its embed. */
function renderGroup(group: RoomGroup, minPlayers = 2) {
  const [, embed] = render(
    room({ memberCount: group.memberIds.length, minPlayers, groups: [group] }),
  );
  return embed;
}

describe('buildChannelPresenceEmbeds — the four qualifying × evented quadrants', () => {
  it('quadrant ✓/✓ — qualifying and evented renders LIVE with the event link', () => {
    const group = renderGroup(
      evented(7, COD, ['hiphoptobop', 'roknua', 'vex'], 903),
    );
    expect(group.author?.name).toBe('▸ LIVE · Quick Play · 3 playing');
    expect(group.color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
    expect(group.description).toContain(
      `[Open event ↗](${CLIENT_URL}/events/903)`,
    );
  });

  it('quadrant ✗/✓ — an event that outlived a departure still renders LIVE', () => {
    const outlived: RoomGroup = {
      ...evented(7, COD, ['roknua'], 941),
      qualifying: false,
    };
    const [, group] = render(room({ memberCount: 1, groups: [outlived] }));
    expect(group.author?.name).toBe('▸ LIVE · Quick Play · 1 playing');
    expect(group.color).toBe(EMBED_COLORS.SIGNUP_CONFIRMATION);
  });

  it('quadrant ✗/✗ — short and unevented still says how many more are needed', () => {
    const group = renderGroup(short(4, 'Valheim', ['morrow']), 3);
    expect(group.author?.name).toBe('◌ NEEDS 2 MORE');
    expect(group.color).toBe(EMBED_COLORS.REMINDER);
    expect(group.description).not.toContain('Open event');
  });

  it('quadrant ✓/✗ — a qualifying group with no event yet reports its count, never "NEEDS"', () => {
    const group = renderGroup(
      qualifyingNoEvent(4, 'Valheim', ['morrow', 'vex', 'roknua']),
    );
    expect(group.author?.name).toBe('◌ 3 playing');
    expect(group.author?.name).not.toContain('NEEDS');
  });

  it('quadrant ✓/✗ — keeps the amber bar, the full roster and no event link', () => {
    const group = renderGroup(
      qualifyingNoEvent(4, 'Valheim', ['morrow', 'vex', 'roknua']),
    );
    expect(group.color).toBe(EMBED_COLORS.REMINDER);
    expect(group.title).toBe('Valheim');
    expect(group.url).toBe(`${CLIENT_URL}/games/4`);
    expect(group.description).toBe('**morrow** · **vex** · **roknua**');
    expect(group.description).not.toContain('Open event');
    expect(group.timestamp).toBeUndefined();
  });
});

describe('buildChannelPresenceEmbeds — the amber author line never invents a shortfall', () => {
  it('reports the count at EXACTLY the threshold, where the old clamp invented a missing player', () => {
    const group = renderGroup(
      qualifyingNoEvent(4, 'Valheim', ['morrow', 'vex']),
    );
    expect(group.author?.name).toBe('◌ 2 playing');
  });

  // Defence in depth: the render re-derives the threshold from the counts it is
  // handed rather than trusting `qualifying` alone, so a stale flag can never
  // route a full group into the "needs" copy (which is what produced F-1).
  it('never says "NEEDS" for a full group even when `qualifying` is stale', () => {
    const stale: RoomGroup = {
      ...short(4, 'Valheim', ['morrow', 'vex', 'roknua']),
      qualifying: false,
    };
    const group = renderGroup(stale);
    expect(group.author?.name).toBe('◌ 3 playing');
  });

  // The other direction, and the reason `qualifying` is read at all rather than
  // the counts alone: when the room layer's verdict and the rendered roster
  // disagree, the VERDICT wins. Neither reading is provably true here, but only
  // one of them can be provably FALSE — `◌ 2 playing` above two names is
  // accurate whatever the threshold is, whereas `NEEDS N MORE` over a group the
  // room layer already cleared is exactly the F-1 falsehood.
  it('trusts `qualifying` over the counts when the two disagree', () => {
    const disagreeing: RoomGroup = {
      ...short(4, 'Valheim', ['morrow', 'vex']),
      qualifying: true,
    };
    const group = renderGroup(disagreeing, 3);
    expect(group.author?.name).toBe('◌ 2 playing');
  });

  // FLAGGED DIVERGENCE (handover): the operator ruled that a Just Chatting group
  // counts members as "in voice", never "playing" (spec §Design reference
  // reconciliation) — but that ruling covers the LIVE author line only. The
  // interim copy for this quadrant is `N playing` for every group, so a
  // qualifying Just Chatting room says "playing" about people who are, by
  // definition, not playing anything. Pinned here so the contradiction is
  // visible in the suite rather than only in a handover note.
  it('says "in voice", never "playing", for a qualifying Just Chatting group', () => {
    const group = renderGroup(
      qualifyingNoEvent(null, 'Just Chatting', ['roknua', 'morrow', 'vex']),
    );
    expect(group.title).toBe(JUST_CHATTING_TITLE);
    expect(group.author?.name).toBe('◌ 3 in voice');
    expect(group.url).toBeUndefined();
  });
});
