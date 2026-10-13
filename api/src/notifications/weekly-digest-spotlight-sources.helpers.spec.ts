/**
 * ROK-1771 L3 — pure shaping for the spotlight candidate reads
 * (shape helpers + the duo's pairing over the reused co-play math).
 */
import {
  pickNamedRunnerUp,
  runnerUpVotes,
  shapeBossKills,
  shapeCommonGround,
  shapeMarathon,
  shapeRisingGame,
  toNumber,
} from './weekly-digest-spotlight-shape.helpers';
import {
  buildDuoCandidate,
  type DuoSessionRow,
} from './weekly-digest-spotlight-duo.helpers';

describe('toNumber', () => {
  it('parses text aggregates and zeroes junk', () => {
    expect(toNumber('7200')).toBe(7200);
    expect(toNumber(null)).toBe(0);
    expect(toNumber('abc')).toBe(0);
  });
});

describe('shapeRisingGame', () => {
  it('returns null without a row', () => {
    expect(shapeRisingGame(undefined)).toBeNull();
  });

  it('converts seconds to hours and keeps both weeks', () => {
    expect(
      shapeRisingGame({
        game_id: 4,
        game_name: 'Valheim',
        this_seconds: '27000',
        prior_seconds: 3600,
        player_count: 3,
      }),
    ).toEqual({
      kind: 'rising_game',
      game: { gameId: 4, name: 'Valheim' },
      hoursThisWeek: 7.5,
      hoursPriorWeek: 1,
      playerCount: 3,
    });
  });
});

describe('shapeBossKills', () => {
  it('returns null when nothing was killed', () => {
    expect(shapeBossKills([])).toBeNull();
  });

  it('counts kills, dedupes and caps first-ever names at 3', () => {
    const c = shapeBossKills([
      { encounter_name: 'Lucifron', first_ever: true },
      { encounter_name: 'Lucifron', first_ever: true },
      { encounter_name: 'Magmadar', first_ever: false },
      { encounter_name: 'Gehennas', first_ever: true },
      { encounter_name: 'Garr', first_ever: true },
      { encounter_name: 'Geddon', first_ever: true },
    ]);
    expect(c).toEqual({
      kind: 'boss_kills',
      instanceName: null,
      killCount: 6,
      firstEverKills: ['Lucifron', 'Gehennas', 'Garr'],
    });
  });
});

describe('Common Ground shaping', () => {
  const lineup = {
    lineup_id: 9,
    decided_game_id: 1,
    decided_game_name: 'Deep Rock',
  };
  const votes = [
    { gameId: 1, voteCount: 5 },
    { gameId: 3, voteCount: 2 },
    { gameId: 2, voteCount: 2 },
  ];

  it('picks the runner-up as the top other game, lower id on ties', () => {
    expect(runnerUpVotes(votes, 1)).toEqual({ gameId: 2, voteCount: 2 });
    expect(runnerUpVotes([{ gameId: 1, voteCount: 4 }], 1)).toBeNull();
  });

  it('builds winner, total and runner-up', () => {
    const named = { gameId: 2, name: 'Valheim', votes: 2 };
    expect(shapeCommonGround(lineup, votes, named)).toEqual({
      kind: 'common_ground',
      lineupId: 9,
      winner: { gameId: 1, name: 'Deep Rock', votes: 5 },
      totalVotes: 9,
      runnerUp: { gameId: 2, name: 'Valheim', votes: 2 },
    });
  });

  it('returns null without a decided lineup; no runner-up name → null', () => {
    expect(shapeCommonGround(undefined, votes, null)).toBeNull();
    expect(shapeCommonGround(lineup, votes, null)?.runnerUp).toBeNull();
  });

  it('falls through a hidden runner-up to the next visible game', () => {
    // Game 2 (the top runner-up) is hidden, so it has no name.
    const names = new Map([[3, 'Satisfactory']]);
    expect(pickNamedRunnerUp(votes, 1, names)).toEqual({
      gameId: 3,
      name: 'Satisfactory',
      votes: 2,
    });
  });

  it('falls through in descending vote order, not ascending', () => {
    const ranked = [
      { gameId: 1, voteCount: 5 },
      { gameId: 2, voteCount: 4 },
      { gameId: 3, voteCount: 2 },
      { gameId: 4, voteCount: 1 },
    ];
    const names = new Map([
      [3, 'Satisfactory'],
      [4, 'Terraria'],
    ]);
    expect(pickNamedRunnerUp(ranked, 1, names)).toEqual({
      gameId: 3,
      name: 'Satisfactory',
      votes: 2,
    });
  });

  it('names no runner-up when every other game is hidden', () => {
    expect(pickNamedRunnerUp(votes, 1, new Map())).toBeNull();
    expect(pickNamedRunnerUp(votes, 1, new Map([[1, 'Deep Rock']]))).toBeNull();
  });
});

describe('shapeMarathon', () => {
  it('rounds minutes and returns null without a row', () => {
    expect(shapeMarathon(undefined)).toBeNull();
    expect(
      shapeMarathon({
        event_id: 5,
        event_title: 'MC clear',
        duration_minutes: '280.4',
        attendee_count: 12,
      }),
    ).toEqual({
      kind: 'marathon',
      eventId: 5,
      eventTitle: 'MC clear',
      durationMinutes: 280,
      attendeeCount: 12,
    });
  });
});

const T0 = Date.parse('2026-10-05T19:00:00Z');
const MIN = 60_000;

function session(
  eventId: number,
  userId: number,
  fromMin: number,
  toMin: number,
): DuoSessionRow {
  return {
    event_id: eventId,
    event_title: `Event ${eventId}`,
    game_id: null,
    user_id: userId,
    user_name: `user${userId}`,
    segments: [
      {
        joinAt: new Date(T0 + fromMin * MIN).toISOString(),
        leaveAt: new Date(T0 + toMin * MIN).toISOString(),
        durationSec: (toMin - fromMin) * 60,
      },
    ],
  };
}

describe('buildDuoCandidate', () => {
  it('returns null when nobody overlapped', () => {
    expect(buildDuoCandidate([])).toBeNull();
    expect(
      buildDuoCandidate([session(1, 1, 0, 30), session(1, 2, 40, 90)]),
    ).toBeNull();
  });

  it('sums overlap across events and picks the top pair', () => {
    const c = buildDuoCandidate([
      session(1, 1, 0, 90),
      session(1, 2, 0, 90),
      session(1, 3, 0, 100),
      session(2, 1, 0, 60),
      session(2, 2, 30, 60),
    ]);
    expect(c).toEqual({
      kind: 'duo',
      members: [
        { userId: 1, name: 'user1' },
        { userId: 2, name: 'user2' },
      ],
      minutesTogether: 120,
      eventCount: 2,
      eventTitles: ['Event 1', 'Event 2'],
    });
  });
});
