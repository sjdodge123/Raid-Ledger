/**
 * Unit tests for co-play pair detection (ROK-948 AC 11).
 */
import {
  aggregateCoPlay,
  voiceOverlapMinutes,
  type SignupRow,
  type VoiceSessionRow,
} from './co-play-graph.helpers';

function segment(joinAt: string, leaveAt: string | null) {
  const durationSec =
    leaveAt !== null
      ? (new Date(leaveAt).getTime() - new Date(joinAt).getTime()) / 1000
      : 0;
  return { joinAt, leaveAt, durationSec };
}

describe('voiceOverlapMinutes (ROK-948 AC 11)', () => {
  it('returns 0 for sessions on different events', () => {
    const a: VoiceSessionRow = {
      eventId: 1,
      userId: 1,
      gameId: 10,
      segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
    };
    const b: VoiceSessionRow = {
      eventId: 2,
      userId: 2,
      gameId: 10,
      segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
    };
    expect(voiceOverlapMinutes(a, b)).toBe(0);
  });

  it('returns the overlap in minutes for two perfectly overlapping sessions', () => {
    const a: VoiceSessionRow = {
      eventId: 1,
      userId: 1,
      gameId: 10,
      segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
    };
    const b: VoiceSessionRow = {
      eventId: 1,
      userId: 2,
      gameId: 10,
      segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
    };
    expect(voiceOverlapMinutes(a, b)).toBe(60);
  });

  it('returns 0 for non-overlapping segments on the same event', () => {
    const a: VoiceSessionRow = {
      eventId: 1,
      userId: 1,
      gameId: 10,
      segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T18:30:00Z')],
    };
    const b: VoiceSessionRow = {
      eventId: 1,
      userId: 2,
      gameId: 10,
      segments: [segment('2026-04-10T18:30:00Z', '2026-04-10T19:00:00Z')],
    };
    expect(voiceOverlapMinutes(a, b)).toBe(0);
  });

  it('sums overlap across multiple segments', () => {
    const a: VoiceSessionRow = {
      eventId: 1,
      userId: 1,
      gameId: 10,
      segments: [
        segment('2026-04-10T18:00:00Z', '2026-04-10T18:20:00Z'),
        segment('2026-04-10T18:40:00Z', '2026-04-10T19:00:00Z'),
      ],
    };
    const b: VoiceSessionRow = {
      eventId: 1,
      userId: 2,
      gameId: 10,
      segments: [segment('2026-04-10T18:10:00Z', '2026-04-10T18:50:00Z')],
    };
    // Overlap: 18:10–18:20 (10 min) + 18:40–18:50 (10 min) = 20 min
    expect(voiceOverlapMinutes(a, b)).toBe(20);
  });
});

describe('aggregateCoPlay (ROK-948 AC 11)', () => {
  it('produces one canonical-ordered pair per overlapping voice session', () => {
    const voice = new Map<number, VoiceSessionRow[]>([
      [
        1,
        [
          {
            eventId: 1,
            userId: 7,
            gameId: 10,
            segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
          },
          {
            eventId: 1,
            userId: 3,
            gameId: 10,
            segments: [segment('2026-04-10T18:15:00Z', '2026-04-10T18:45:00Z')],
          },
        ],
      ],
    ]);
    const result = aggregateCoPlay(voice, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].userIdA).toBe(3);
    expect(result[0].userIdB).toBe(7);
    expect(result[0].sessionCount).toBe(1);
    expect(result[0].totalMinutes).toBe(30);
    expect(result[0].gamesPlayed).toEqual([10]);
  });

  it('builds pairs from shared signups when no voice sessions exist', () => {
    const signups = new Map<number, SignupRow[]>([
      [
        1,
        [
          { eventId: 1, userId: 5, gameId: 20 },
          { eventId: 1, userId: 2, gameId: 20 },
          { eventId: 1, userId: 9, gameId: 20 },
        ],
      ],
    ]);
    const result = aggregateCoPlay(new Map(), signups);
    // 3 users → 3 pairs: (2,5), (2,9), (5,9)
    expect(result).toHaveLength(3);
    for (const pair of result) {
      expect(pair.userIdA).toBeLessThan(pair.userIdB);
      expect(pair.gamesPlayed).toEqual([20]);
    }
  });

  it('combines voice and signup evidence for the same pair', () => {
    const voice = new Map<number, VoiceSessionRow[]>([
      [
        1,
        [
          {
            eventId: 1,
            userId: 1,
            gameId: 10,
            segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
          },
          {
            eventId: 1,
            userId: 2,
            gameId: 10,
            segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T18:30:00Z')],
          },
        ],
      ],
    ]);
    const signups = new Map<number, SignupRow[]>([
      [
        2,
        [
          { eventId: 2, userId: 1, gameId: 20 },
          { eventId: 2, userId: 2, gameId: 20 },
        ],
      ],
    ]);
    const result = aggregateCoPlay(voice, signups);
    expect(result).toHaveLength(1);
    expect(result[0].userIdA).toBe(1);
    expect(result[0].userIdB).toBe(2);
    expect(result[0].sessionCount).toBe(2);
    // Game IDs from BOTH sources accumulated
    expect(result[0].gamesPlayed.sort()).toEqual([10, 20]);
  });

  it('skips anonymous (null userId) voice sessions', () => {
    const voice = new Map<number, VoiceSessionRow[]>([
      [
        1,
        [
          {
            eventId: 1,
            userId: null,
            gameId: 10,
            segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
          },
          {
            eventId: 1,
            userId: 2,
            gameId: 10,
            segments: [segment('2026-04-10T18:00:00Z', '2026-04-10T19:00:00Z')],
          },
        ],
      ],
    ]);
    expect(aggregateCoPlay(voice, new Map())).toEqual([]);
  });
});
