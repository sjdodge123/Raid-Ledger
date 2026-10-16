/**
 * ROK-1801 layer C — the presence card's game-server rendering, pinned to the
 * operator's previews (spec D4 + rulings Q1/Q4/Q7/Q8). Every expectation is the
 * exact embed line Discord shows: markers sit OUTSIDE the bold, an unnamed
 * unlinked player is an anonymous `+N on server`, the header stays voice-only,
 * and the author-line count is voice ∪ server (`groupSize`).
 */
import { buildChannelPresenceEmbeds } from './channel-presence-embed.helpers';
import type { EmbedContext } from './discord-embed.factory';
import type { ResolvedRoom, RoomGroup } from './channel-presence-room.helpers';
import type { ServerRosterEntry } from './server-presence-roster.helpers';
import { nonEmpty } from '../../common/testing/narrow';

const NOW = Date.parse('2026-10-16T18:00:00Z');
const CONTEXT: EmbedContext = {
  communityName: 'Gamer Saloon',
  clientUrl: 'https://rl.example',
  timezone: 'UTC',
};

function serverPlayer(name: string | null, i: number): ServerRosterEntry {
  return {
    key: `steam:${String(i)}`,
    steamId: `7656119800000000${String(i)}`,
    userId: null,
    discordUserId: null,
    name,
  };
}

function valheim(overrides: Partial<RoomGroup>): RoomGroup {
  return {
    gameId: 5,
    gameName: 'Valheim',
    memberIds: [],
    memberNames: [],
    qualifying: false,
    eventId: null,
    eventData: null,
    game: null,
    ...overrides,
  };
}

function room(groups: RoomGroup[], extra: Partial<ResolvedRoom>): ResolvedRoom {
  return {
    channelId: 'vc-1',
    channelName: 'Gamer Night',
    memberCount: 0,
    minPlayers: 2,
    groups,
    undetectedNames: [],
    ...extra,
  };
}

/** Header, then per group [author, description], then lead field values. */
function lines(r: ResolvedRoom): string[] {
  const [lead, ...groups] = nonEmpty(
    buildChannelPresenceEmbeds(r, CONTEXT, NOW).map((e) => e.data),
    'embeds',
  );
  return [
    lead.title ?? '',
    ...groups.flatMap((g) => [g.author?.name ?? '', g.description ?? '']),
    ...(lead.fields ?? []).map((f) => `${f.name}: ${f.value}`),
  ];
}

describe('presence card — game-server markers (ROK-1801)', () => {
  it("renders the operator's worked example: voice member on the server gets 🖥", () => {
    const group = valheim({
      memberIds: ['u-lanati', 'u-pariah'],
      memberNames: ['L✿anati', 'Pariah'],
      onServerIds: ['u-pariah'],
      qualifying: true,
    });
    expect(
      lines(
        room([group], { memberCount: 3, undetectedNames: ['ProbablyaCat'] }),
      ),
    ).toEqual([
      '\u{1F50A} Gamer Night · 3 in voice',
      '◌ 2 playing',
      '**L✿anati** · **Pariah** \u{1F5A5}',
      'In channel · no game detected: **ProbablyaCat**',
    ]);
  });

  it('renders a server-only group (Q1) with named and anonymous players (Q4)', () => {
    const group = valheim({
      serverOnly: [
        serverPlayer('Bjorn', 1),
        serverPlayer(null, 2),
        serverPlayer('Ragna', 3),
        serverPlayer(null, 4),
      ],
    });
    expect(
      lines(room([group], { memberCount: 1, undetectedNames: ['Ana'] })),
    ).toEqual([
      '\u{1F50A} Gamer Night · 1 in voice',
      '◌ 4 playing',
      '**Bjorn** \u{1F5A5} on server · **Ragna** \u{1F5A5} on server · +2 on server',
      'In channel · no game detected: **Ana**',
    ]);
  });

  it('counts a server-only player toward NEEDS: 1 voice + 1 server at minPlayers 3', () => {
    const group = valheim({
      memberIds: ['u-ana'],
      memberNames: ['Ana'],
      serverOnly: [serverPlayer('Kveldulf', 1)],
    });
    expect(lines(room([group], { memberCount: 1, minPlayers: 3 }))).toEqual([
      '\u{1F50A} Gamer Night · 1 in voice',
      '◌ NEEDS 1 MORE',
      '**Ana** · **Kveldulf** \u{1F5A5} on server',
    ]);
  });

  it('flips NEEDS 1 MORE to 2 playing once a server-only player is added', () => {
    const alone = valheim({ memberIds: ['u-ana'], memberNames: ['Ana'] });
    const withServer = { ...alone, serverOnly: [serverPlayer('Kveldulf', 1)] };
    expect(lines(room([alone], { memberCount: 1 }))[1]).toBe('◌ NEEDS 1 MORE');
    expect(lines(room([withServer], { memberCount: 1 }))[1]).toBe(
      '◌ 2 playing',
    );
  });

  it('renders an anonymous-only group as just +1 on server', () => {
    const group = valheim({ serverOnly: [serverPlayer(null, 1)] });
    expect(lines(room([group], { memberCount: 1, minPlayers: 3 }))).toEqual([
      '\u{1F50A} Gamer Night · 1 in voice',
      '◌ NEEDS 2 MORE',
      '+1 on server',
    ]);
  });

  it('never renders a SteamID, and escapes a marker-shaped name inside the bold', () => {
    const group = valheim({
      serverOnly: [serverPlayer('*bold*', 1), serverPlayer(null, 2)],
    });
    const description = lines(room([group], { memberCount: 1 }))[2] ?? '';
    expect(description).toBe(
      '**\\*bold\\*** \u{1F5A5} on server · +1 on server',
    );
    expect(description).not.toMatch(/7656119/);
  });

  it('marks evented roster entries from rosterSuffix, outside the bold', () => {
    const group = valheim({
      memberIds: ['u-ana'],
      memberNames: ['Ana'],
      qualifying: true,
      eventId: 77,
      eventData: {
        id: 77,
        title: 'Valheim — Quick Play',
        startTime: '2026-10-16T17:00:00Z',
        endTime: '2026-10-16T20:00:00Z',
        signupCount: 2,
        signupMentions: [
          {
            username: 'Ana',
            role: null,
            preferredRoles: null,
            rosterSuffix: ' \u{1F5A5}',
          },
          {
            username: 'Kveldulf',
            role: null,
            preferredRoles: null,
            rosterSuffix: ' \u{1F5A5} on server',
          },
        ],
        game: { id: 5, name: 'Valheim' },
      },
    });
    const embeds = buildChannelPresenceEmbeds(
      room([group], { memberCount: 1 }),
      CONTEXT,
      NOW,
    ).map((e) => e.data);
    expect(embeds[1]?.description ?? '').toContain(
      '**Ana** \u{1F5A5} · **Kveldulf** \u{1F5A5} on server',
    );
  });
});
