/**
 * ROK-1446 (Lane A) — TDD pins for design render 5, "Session ended".
 *
 * The room emptied, so the SAME message is edited into a recap: no new message
 * is ever posted (D8 — "completions fold into the final state"). What changes:
 *   - the lead title becomes `🔊 {channel} · session ended`
 *   - every SHORT group vanishes entirely — a group that never cleared the
 *     threshold has no session to report (D3)
 *   - each surviving session renders `buildQuickPlayEmbed(..., 'ended')`, so
 *     the bar goes grey, the author line carries a duration, badges drop away
 *     and `Attendance · N players` takes their place
 *
 * Assertions read `embed.data` (the raw API payload), never builder internals.
 */
import { EMBED_COLORS } from '../discord-bot.constants';
import { buildRecapEmbeds } from './channel-presence-embed.recap.helpers';
import { JUST_CHATTING_TITLE } from './channel-presence-embed.helpers';
import { MAX_GROUP_EMBEDS } from './channel-presence-embed.lead.helpers';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import type { RoomRecap } from './channel-presence-room-recap.helpers';

const CLIENT_URL = 'https://rl.example';
const OPENED_AT = new Date('2026-09-02T20:55:00Z');
/** Well after every fixture's end time, so nothing is clamped by default. */
const NOW = Date.parse('2026-09-03T02:00:00Z');

const CONTEXT: EmbedContext = {
  communityName: 'Gamer Saloon',
  clientUrl: CLIENT_URL,
  timezone: 'UTC',
};

/** `<t:epoch:t>` — the token D3 puts in the recap's session window. */
function token(iso: string): string {
  return `<t:${Math.floor(Date.parse(iso) / 1000)}:t>`;
}

function session(
  id: number,
  gameName: string | null,
  startTime: string,
  endTime: string,
  names: string[],
): EmbedEventData {
  return {
    id,
    title: `${gameName ?? 'Untitled Gaming Session'} — Quick Play`,
    startTime,
    endTime,
    signupCount: names.length,
    signupMentions: names.map((name) => ({
      displayName: name,
      role: null,
      preferredRoles: null,
      status: 'confirmed',
    })),
    ...(gameName === null
      ? {}
      : {
          game: {
            id: 7,
            name: gameName,
            coverUrl: 'https://cdn.example/cod.png',
            // Adversarial on purpose: badges are HYDRATED here so "badges drop
            // away at ENDED" cannot pass vacuously.
            badges: { cooptimusOnlineMax: 16, isFreeToPlay: true },
          },
        }),
  };
}

const COD = session(
  41,
  'Call of Duty 4: Modern Warfare',
  '2026-09-02T21:02:00Z',
  '2026-09-02T23:47:00Z',
  ['hiphoptobop', 'roknua', 'vex'],
);
const DRG = session(
  42,
  'Deep Rock Galactic',
  '2026-09-02T21:30:00Z',
  '2026-09-02T22:42:00Z',
  ['morrow', 'tinnitus'],
);

function render(
  events: EmbedEventData[],
  now = NOW,
  endedAt: number | null = null,
) {
  return buildRecapEmbeds(
    { channelName: 'General', events, openedAt: OPENED_AT, endedAt },
    CONTEXT,
    now,
  ).map((e) => e.data);
}

describe('buildRecapEmbeds — the lead embed', () => {
  it('announces the session ended and stays grey', () => {
    const [lead] = render([COD, DRG]);
    expect(lead.title).toBe('\u{1F50A} General · session ended');
    expect(lead.url).toBeUndefined();
    expect(lead.color).toBe(EMBED_COLORS.SYSTEM);
  });

  it('reports the session count and the window spanned by the sessions', () => {
    const [lead] = render([COD, DRG]);
    expect(lead.description).toBe(
      `2 sessions · ${token('2026-09-02T21:02:00Z')}–${token(
        '2026-09-02T23:47:00Z',
      )}`,
    );
  });

  it('singularises a lone session', () => {
    const [lead] = render([DRG]);
    expect(lead.description).toBe(
      `1 session · ${token('2026-09-02T21:30:00Z')}–${token(
        '2026-09-02T22:42:00Z',
      )}`,
    );
  });

  it('says nothing started when the room never spawned a session', () => {
    const embeds = render([]);
    expect(embeds).toHaveLength(1);
    expect(embeds[0].description).toBe('No session started.');
  });

  it('carries no "no game detected" field — the room is empty (D3)', () => {
    const [lead] = render([COD, DRG]);
    expect(lead.fields ?? []).toHaveLength(0);
  });

  it('timestamps from opened_at, so re-rendering the recap is idempotent', () => {
    const [lead] = render([COD, DRG]);
    const again = render([COD, DRG], NOW + 600_000)[0];
    expect(lead.timestamp).toBe(OPENED_AT.toISOString());
    expect(again.timestamp).toBe(lead.timestamp);
  });

  it('falls back to a generic channel name when the channel is gone', () => {
    const [lead] = buildRecapEmbeds(
      { channelName: null, events: [], openedAt: OPENED_AT, endedAt: null },
      CONTEXT,
      NOW,
    ).map((e) => e.data);
    expect(lead.title).toBe('\u{1F50A} Voice channel · session ended');
  });
});

describe('buildRecapEmbeds — the session embeds', () => {
  it('renders one ENDED embed per session, oldest first, all grey', () => {
    const embeds = render([DRG, COD]);
    expect(embeds).toHaveLength(3);
    expect(embeds.map((e) => e.author?.name)).toEqual([
      'Gamer Saloon',
      '■ ENDED · Quick Play · 2h 45m',
      '■ ENDED · Quick Play · 1h 12m',
    ]);
    expect(embeds.map((e) => e.color)).toEqual([
      EMBED_COLORS.SYSTEM,
      EMBED_COLORS.SYSTEM,
      EMBED_COLORS.SYSTEM,
    ]);
  });

  it('drops the badges and reports attendance instead', () => {
    const [, cod] = render([COD, DRG]);
    expect(cod.fields ?? []).toHaveLength(0);
    expect(cod.description).toContain('Attendance · 3 players');
    expect(cod.description).toContain('**roknua**');
  });

  it('never emits a raw mention in any slot of the recap', () => {
    const noisy = session(
      43,
      'Valheim',
      '2026-09-02T21:00:00Z',
      '2026-09-02T22:00:00Z',
      ['<@123456789012345678>', '<@!987654321098765432>'],
    );
    expect(JSON.stringify(render([noisy]))).not.toContain('<@');
  });

  it('titles a gameless session as Just Chatting, matching the live render', () => {
    const chatting = session(
      44,
      null,
      '2026-09-02T21:00:00Z',
      '2026-09-02T22:00:00Z',
      ['roknua', 'morrow'],
    );
    const [, group] = render([chatting]);
    expect(group.title).toBe(JUST_CHATTING_TITLE);
    expect(group.url).toBeUndefined();
  });

  it('caps the message at Discord’s ten embeds', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      session(
        100 + i,
        `Game ${String(i)}`,
        `2026-09-02T2${String(i % 4)}:00:00Z`,
        '2026-09-02T23:00:00Z',
        ['a', 'b'],
      ),
    );
    const embeds = render(many);
    expect(embeds).toHaveLength(MAX_GROUP_EMBEDS + 1);
  });
});

describe('buildRecapEmbeds — a session still live when the room emptied (D8)', () => {
  const live = session(
    45,
    'Valheim',
    '2026-09-02T21:00:00Z',
    // An open-ended upper bound: the row says the session runs for hours yet.
    '2026-09-03T05:00:00Z',
    ['roknua', 'morrow'],
  );
  const closedAt = Date.parse('2026-09-02T22:30:00Z');

  it('ends it at the recap clock rather than believing a future end time', () => {
    const [, group] = render([live], closedAt);
    expect(group.author?.name).toBe('■ ENDED · Quick Play · 1h 30m');
  });

  it('closes the lead window at the recap clock too', () => {
    const [lead] = render([live], closedAt);
    expect(lead.description).toBe(
      `1 session · ${token('2026-09-02T21:00:00Z')}–${token(
        '2026-09-02T22:30:00Z',
      )}`,
    );
  });

  it('clamps to empty_since rather than the flush clock, so the payload is stable (S-5)', () => {
    // Same room, same still-live session, two flushes 90 s apart. Clamping to
    // `now` moves every rendered end time and therefore the D5 payload hash,
    // so the recap would edit Discord on every tick forever and the
    // "session ended" the reader sees would creep minute by minute.
    const first = render([live], closedAt, closedAt);
    const later = render([live], closedAt + 90_000, closedAt);

    expect(later[0].description).toBe(first[0].description);
    expect(later[1].author?.name).toBe('■ ENDED · Quick Play · 1h 30m');
  });
});

/**
 * ROK-1499 — the room line.
 *
 * Prod, 2026-09-13: a general-lobby room held three people for ~3h playing
 * three different games. Nobody's group cleared the quick-play threshold, so
 * no session existed, so the recap said "No session started." about a room
 * that had just hosted a full evening. The lead embed now describes the ROOM
 * first and the sessions second.
 */
/** 2h 55m, the real occupancy window from the prod incident. */
const SPAN_MS = 2 * 3_600_000 + 55 * 60_000;

const THREE_PLAYING: RoomRecap = {
  spanMs: SPAN_MS,
  members: [
    { displayName: 'roknua', seconds: 10_500 },
    { displayName: 'hiphoptobop', seconds: 9_000 },
    { displayName: 'vex', seconds: 6_240 },
  ],
  activities: [
    { name: 'Path of Exile 2', seconds: 2 * 3600 + 48 * 60 },
    { name: 'WoW Classic', seconds: 3 * 3600 + 29 * 60 },
    // No game_id — layer 2 passes the raw presence name through.
    { name: 'Slay the Spire II', seconds: 3600 + 44 * 60 },
  ],
};

function renderRoom(
  room: RoomRecap | null,
  events: EmbedEventData[] = [],
  rosterCap?: number,
) {
  return buildRecapEmbeds(
    {
      channelName: 'General',
      events,
      openedAt: OPENED_AT,
      endedAt: null,
      room,
    },
    CONTEXT,
    NOW,
    rosterCap,
  ).map((e) => e.data);
}

/** THREE_PLAYING's roster, as the participant line renders it (ROK-1608). */
const NAMES = '**roknua** · **hiphoptobop** · **vex**';

describe('buildRecapEmbeds — the room line', () => {
  it('still says nothing happened when the room recap has no members', () => {
    const [lead] = renderRoom({ spanMs: SPAN_MS, members: [], activities: [] });
    expect(lead.description).toBe('No session started.');
  });

  it('describes a room whose occupants produced no game', () => {
    const [lead] = renderRoom({
      spanMs: SPAN_MS,
      members: THREE_PLAYING.members,
      activities: [],
    });
    expect(lead.description).toBe(
      `3 in voice \u00b7 no game detected\n${NAMES}`,
    );
  });

  it('singularises a lone occupant', () => {
    const [lead] = renderRoom({
      spanMs: SPAN_MS,
      members: [{ displayName: 'roknua', seconds: 10_500 }],
      activities: [],
    });
    expect(lead.description).toBe('1 in voice · no game detected\n**roknua**');
  });

  it('lists what the room played, in the order the summariser ranked it', () => {
    const [lead] = renderRoom(THREE_PLAYING);
    expect(lead.description).toBe(
      '3 in voice · Path of Exile 2 (2h 48m) · WoW Classic (3h 29m) · ' +
        `Slay the Spire II (1h 44m)\n${NAMES}`,
    );
  });

  it('caps a busy room at five games and counts the rest', () => {
    const [lead] = renderRoom({
      spanMs: SPAN_MS,
      members: THREE_PLAYING.members,
      activities: Array.from({ length: 8 }, (_, i) => ({
        name: `Game ${String(i)}`,
        seconds: 3600,
      })),
    });
    expect(lead.description).toBe(
      '3 in voice · Game 0 (1h) · Game 1 (1h) · Game 2 (1h) · Game 3 (1h) · ' +
        `Game 4 (1h) · +3 more\n${NAMES}`,
    );
  });
});

describe('buildRecapEmbeds — the room title', () => {
  it('keeps the session line underneath when a group did qualify', () => {
    const [lead] = renderRoom(THREE_PLAYING, [DRG]);
    expect(lead.description).toBe(
      '3 in voice · Path of Exile 2 (2h 48m) · WoW Classic (3h 29m) · ' +
        `Slay the Spire II (1h 44m)\n${NAMES}\n` +
        `1 session · ${token('2026-09-02T21:30:00Z')}–${token(
          '2026-09-02T22:42:00Z',
        )}`,
    );
  });

  it('puts how long the room was open in the title', () => {
    const [lead] = renderRoom(THREE_PLAYING);
    expect(lead.title).toBe('\u{1F50A} General · session ended · 2h 55m');
  });

  it('leaves the title alone when the room never opened for measurable time', () => {
    const [lead] = renderRoom({ spanMs: 0, members: [], activities: [] });
    expect(lead.title).toBe('\u{1F50A} General · session ended');
  });
});

/**
 * ROK-1608 — "Also I'd like the participants to be listed." The recap counted
 * five people in voice and named none of them.
 */
describe('buildRecapEmbeds — the participant line', () => {
  it('names who was in the room, under the room line', () => {
    const [lead] = renderRoom(THREE_PLAYING);
    expect(lead.description?.split('\n')[1]).toBe(NAMES);
  });

  it('caps the names and counts the rest, like any other roster', () => {
    const [lead] = renderRoom({
      spanMs: SPAN_MS,
      members: Array.from({ length: 9 }, (_, i) => ({
        displayName: `member-${String(i)}`,
        seconds: 3600,
      })),
      activities: [],
    });
    expect(lead.description?.split('\n')[1]).toBe(
      '**member-0** · **member-1** · **member-2** · **member-3** · ' +
        '**member-4** · **member-5** +3 more',
    );
  });

  it('honours a lowered roster cap, so the budget guard still bites', () => {
    const [lead] = renderRoom(THREE_PLAYING, [], 2);
    expect(lead.description?.split('\n')[1]).toBe(
      '**roknua** · **hiphoptobop** +1 more',
    );
  });

  it('defangs a display name shaped like a mention or a masked link', () => {
    const [lead] = renderRoom({
      spanMs: SPAN_MS,
      members: [
        { displayName: '<@123456789>', seconds: 3600 },
        { displayName: '[click me](https://evil.example)', seconds: 60 },
      ],
      activities: [],
    });
    const names = lead.description?.split('\n')[1] ?? '';
    expect(names).not.toMatch(/<@/);
    expect(names).toBe(
      '**123456789** · **\\[click me\\]\\(https://evil.example\\)**',
    );
  });

  it('adds no participant line when the room recap has no members', () => {
    const [lead] = renderRoom({ spanMs: SPAN_MS, members: [], activities: [] });
    expect(lead.description).toBe('No session started.');
  });
});
