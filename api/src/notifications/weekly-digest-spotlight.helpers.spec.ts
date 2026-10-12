/**
 * ROK-1771 L4 — spotlight pick rule + rotation memory (pure unit tests).
 */
import {
  formatSpotlightWeek,
  isSpotlightEligible,
  lastSpotlightKind,
  parseSpotlightHistory,
  pickSpotlight,
  previousSpotlightWeek,
  serializeSpotlightHistory,
  spotlightScore,
  type SpotlightCandidate,
  type SpotlightHistoryEntry,
  type SpotlightKind,
} from './weekly-digest-spotlight.helpers';

const WEEK = '2026-W41';

function rising(
  deltaHours: number,
  players = 3,
  priorHours = 5,
): SpotlightCandidate {
  return {
    kind: 'rising_game',
    game: { gameId: 1, name: 'Helldivers 2' },
    hoursThisWeek: priorHours + deltaHours,
    hoursPriorWeek: priorHours,
    playerCount: players,
  };
}

function duo(minutes: number, events = 2): SpotlightCandidate {
  return {
    kind: 'duo',
    members: [
      { userId: 1, name: 'Brightwing' },
      { userId: 2, name: 'Kael' },
    ],
    minutesTogether: minutes,
    eventCount: events,
    eventTitles: ['Molten Core'],
  };
}

function boss(kills: number, firsts: string[] = []): SpotlightCandidate {
  return {
    kind: 'boss_kills',
    instanceName: 'Molten Core',
    killCount: kills,
    firstEverKills: firsts,
  };
}

function lineup(totalVotes: number): SpotlightCandidate {
  return {
    kind: 'common_ground',
    lineupId: 7,
    winner: { gameId: 3, name: 'Valheim', votes: totalVotes },
    totalVotes,
    runnerUp: null,
  };
}

function marathon(minutes: number): SpotlightCandidate {
  return {
    kind: 'marathon',
    eventId: 9,
    eventTitle: 'Molten Core — Week 5',
    durationMinutes: minutes,
    attendeeCount: 18,
  };
}

/** One candidate per kind, every one scoring exactly 2. */
const SCORE_TWO: Record<SpotlightKind, SpotlightCandidate> = {
  boss_kills: boss(2),
  common_ground: lineup(6),
  duo: duo(240),
  rising_game: rising(6),
  marathon: marathon(360),
};

function entry(week: string, kind: SpotlightKind): SpotlightHistoryEntry {
  return { week, kind };
}

describe('pickSpotlight', () => {
  it('picks the highest score', () => {
    const picked = pickSpotlight([duo(240), marathon(600)], [], WEEK);
    expect(picked?.kind).toBe('marathon');
  });

  it('every SCORE_TWO fixture really scores 2', () => {
    const scores = Object.values(SCORE_TWO).map(spotlightScore);
    expect(scores).toEqual([2, 2, 2, 2, 2]);
  });

  it.each<[SpotlightKind, SpotlightKind]>([
    ['boss_kills', 'common_ground'],
    ['common_ground', 'duo'],
    ['duo', 'rising_game'],
    ['rising_game', 'marathon'],
  ])('a tie goes to %s over %s, in either input order', (rarer, commoner) => {
    const a = SCORE_TWO[rarer];
    const b = SCORE_TWO[commoner];
    expect(pickSpotlight([a, b], [], WEEK)?.kind).toBe(rarer);
    expect(pickSpotlight([b, a], [], WEEK)?.kind).toBe(rarer);
  });

  it('caps scores at 5 so a capped tie still goes to rarity', () => {
    expect(spotlightScore(marathon(10_000))).toBe(5);
    const picked = pickSpotlight([marathon(10_000), boss(9)], [], WEEK);
    expect(picked?.kind).toBe('boss_kills');
  });

  it('a first-ever kill doubles the boss-kill metric', () => {
    expect(spotlightScore(boss(2, ['Ragnaros']))).toBe(4);
    expect(spotlightScore(boss(2))).toBe(2);
  });

  it("excludes last week's kind even when it scores highest", () => {
    const history = [entry('2026-W40', 'marathon')];
    const picked = pickSpotlight([marathon(900), duo(240)], history, WEEK);
    expect(picked?.kind).toBe('duo');
  });

  it('ignores a same-week history entry (a re-fire is not "last week")', () => {
    const history = [entry(WEEK, 'marathon'), entry('2026-W40', 'duo')];
    expect(lastSpotlightKind(history, WEEK)).toBe('duo');
    const picked = pickSpotlight([marathon(900), duo(600)], history, WEEK);
    expect(picked?.kind).toBe('marathon');
  });

  it("returns null when only last week's kind is eligible", () => {
    const history = [entry('2026-W40', 'marathon')];
    expect(pickSpotlight([marathon(900), duo(60)], history, WEEK)).toBeNull();
  });

  it('a kind last shown two weeks ago is eligible again (no spotlight last week)', () => {
    const history = [entry('2026-W39', 'marathon')];
    expect(lastSpotlightKind(history, WEEK)).toBeNull();
    expect(pickSpotlight([marathon(900)], history, WEEK)?.kind).toBe(
      'marathon',
    );
  });

  it("excludes last week's kind, not an older week's", () => {
    const history = [entry('2026-W40', 'duo'), entry('2026-W39', 'marathon')];
    expect(lastSpotlightKind(history, WEEK)).toBe('duo');
    const picked = pickSpotlight([marathon(900), duo(600)], history, WEEK);
    expect(picked?.kind).toBe('marathon');
  });

  it.each([
    ['2026-W41', '2026-W40'],
    ['2026-W01', '2025-W52'],
    ['2027-W01', '2026-W53'],
    ['2021-W01', '2020-W53'],
  ])('the ISO week before %s is %s', (week, previous) => {
    expect(previousSpotlightWeek(week)).toBe(previous);
    expect(lastSpotlightKind([entry(previous, 'duo')], week)).toBe('duo');
  });

  it('returns null when nothing is eligible or there are no candidates', () => {
    expect(pickSpotlight([], [], WEEK)).toBeNull();
    expect(pickSpotlight([marathon(120), lineup(2)], [], WEEK)).toBeNull();
  });
});

describe('isSpotlightEligible', () => {
  it.each<[string, SpotlightCandidate]>([
    ['rising game: delta under 3 h', rising(2.9)],
    ['rising game: one player', rising(6, 1)],
    ['rising game: under 5 h this week', rising(4, 3, 0.5)],
    ['duo: under 120 min', duo(119)],
    ['duo: one event', duo(300, 1)],
    ['boss kills: zero kills', boss(0)],
    ['common ground: two votes', lineup(2)],
    ['marathon: under 3 h', marathon(179)],
  ])('%s is ineligible and never picked', (_label, candidate) => {
    expect(isSpotlightEligible(candidate)).toBe(false);
    expect(pickSpotlight([candidate], [], WEEK)).toBeNull();
  });

  it.each(Object.values(SCORE_TWO))('$kind at score 2 is eligible', (c) => {
    expect(isSpotlightEligible(c)).toBe(true);
  });
});

describe('spotlight history parse', () => {
  it.each<[string, string | null | undefined]>([
    ['not JSON', '{not json'],
    ['an object', '{"week":"2026-W40","kind":"duo"}'],
    ['JSON null', 'null'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('malformed history (%s) parses to []', (_label, raw) => {
    expect(parseSpotlightHistory(raw)).toEqual([]);
  });

  it('drops invalid entries and sorts newest first', () => {
    const raw = JSON.stringify([
      { week: '2026-W38', kind: 'duo' },
      { week: '2026-W40', kind: 'nope' },
      { week: 'W39', kind: 'marathon' },
      'junk',
      { week: '2026-W40', kind: 'boss_kills' },
    ]);
    expect(parseSpotlightHistory(raw)).toEqual([
      entry('2026-W40', 'boss_kills'),
      entry('2026-W38', 'duo'),
    ]);
  });

  it('caps parsed history at 4 entries, keeping the newest', () => {
    const weeks = ['2026-W35', '2026-W36', '2026-W37', '2026-W38', '2026-W39'];
    const raw = JSON.stringify(weeks.map((w) => entry(w, 'duo')));
    const parsed = parseSpotlightHistory(raw);
    expect(parsed.map((e) => e.week)).toEqual([
      '2026-W39',
      '2026-W38',
      '2026-W37',
      '2026-W36',
    ]);
  });
});

describe('spotlight history serialize', () => {
  it('serialize prepends, caps at 4 and round-trips', () => {
    const history = ['2026-W40', '2026-W39', '2026-W38', '2026-W37'].map((w) =>
      entry(w, 'marathon'),
    );
    const json = serializeSpotlightHistory(history, entry(WEEK, 'duo'));
    expect(parseSpotlightHistory(json)).toEqual([
      entry(WEEK, 'duo'),
      entry('2026-W40', 'marathon'),
      entry('2026-W39', 'marathon'),
      entry('2026-W38', 'marathon'),
    ]);
  });

  it('serialize replaces an existing entry for the same week', () => {
    const history = [entry(WEEK, 'marathon'), entry('2026-W40', 'duo')];
    const json = serializeSpotlightHistory(history, entry(WEEK, 'boss_kills'));
    expect(JSON.parse(json)).toEqual([
      entry(WEEK, 'boss_kills'),
      entry('2026-W40', 'duo'),
    ]);
  });

  it('lastSpotlightKind is null with no earlier week', () => {
    expect(lastSpotlightKind([], WEEK)).toBeNull();
    expect(lastSpotlightKind([entry(WEEK, 'duo')], WEEK)).toBeNull();
  });

  it('formats an ISO week like the digest dedup key', () => {
    expect(formatSpotlightWeek({ year: 2026, week: 1 })).toBe('2026-W01');
    expect(formatSpotlightWeek({ year: 2026, week: 41 })).toBe(WEEK);
  });
});
