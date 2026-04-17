/**
 * Co-play pair detection (ROK-948 AC 5).
 *
 * Two users form a co-play pair when:
 *   - They both appear in event_voice_sessions for the same event with
 *     overlapping time segments, OR
 *   - They both have event_signups on the same event with status in
 *     ('signed_up', 'confirmed').
 *
 * Pairs are stored canonically: user_id_a < user_id_b (CHECK constraint).
 */

export interface VoiceSessionRow {
  eventId: number;
  userId: number | null;
  gameId: number | null;
  segments: Array<{
    joinAt: string;
    leaveAt: string | null;
    durationSec: number;
  }>;
}

export interface SignupRow {
  eventId: number;
  userId: number | null;
  gameId: number | null;
}

export interface CoPlayAggregate {
  userIdA: number;
  userIdB: number;
  sessionCount: number;
  totalMinutes: number;
  lastPlayedAt: Date;
  gamesPlayed: number[];
}

/** Compute overlap minutes for a pair of voice sessions on the same event. */
export function voiceOverlapMinutes(
  a: VoiceSessionRow,
  b: VoiceSessionRow,
): number {
  if (a.eventId !== b.eventId) return 0;
  let totalSec = 0;
  for (const segA of a.segments) {
    const startA = new Date(segA.joinAt).getTime();
    const endA = segA.leaveAt ? new Date(segA.leaveAt).getTime() : startA;
    for (const segB of b.segments) {
      const startB = new Date(segB.joinAt).getTime();
      const endB = segB.leaveAt ? new Date(segB.leaveAt).getTime() : startB;
      const start = Math.max(startA, startB);
      const end = Math.min(endA, endB);
      if (end > start) totalSec += (end - start) / 1000;
    }
  }
  return Math.round(totalSec / 60);
}

function lastSegmentEnd(session: VoiceSessionRow): Date {
  let latest = 0;
  for (const seg of session.segments) {
    const end = seg.leaveAt
      ? new Date(seg.leaveAt).getTime()
      : new Date(seg.joinAt).getTime();
    if (end > latest) latest = end;
  }
  return new Date(latest);
}

function canonicalKey(a: number, b: number): [number, number, string] {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return [lo, hi, `${lo}:${hi}`];
}

function upsertAggregate(
  map: Map<string, CoPlayAggregate>,
  a: number,
  b: number,
  minutes: number,
  lastPlayedAt: Date,
  gameId: number | null,
): void {
  const [lo, hi, key] = canonicalKey(a, b);
  const existing = map.get(key);
  if (existing) {
    existing.sessionCount += 1;
    existing.totalMinutes += minutes;
    if (lastPlayedAt > existing.lastPlayedAt)
      existing.lastPlayedAt = lastPlayedAt;
    if (gameId !== null && !existing.gamesPlayed.includes(gameId))
      existing.gamesPlayed.push(gameId);
  } else {
    map.set(key, {
      userIdA: lo,
      userIdB: hi,
      sessionCount: 1,
      totalMinutes: minutes,
      lastPlayedAt,
      gamesPlayed: gameId !== null ? [gameId] : [],
    });
  }
}

export function aggregateCoPlay(
  voiceSessionsByEvent: Map<number, VoiceSessionRow[]>,
  signupsByEvent: Map<number, SignupRow[]>,
): CoPlayAggregate[] {
  const map = new Map<string, CoPlayAggregate>();

  for (const [, sessions] of voiceSessionsByEvent) {
    for (let i = 0; i < sessions.length; i++) {
      const a = sessions[i];
      if (a.userId === null) continue;
      for (let j = i + 1; j < sessions.length; j++) {
        const b = sessions[j];
        if (b.userId === null || a.userId === b.userId) continue;
        const minutes = voiceOverlapMinutes(a, b);
        if (minutes === 0) continue;
        const lastPlayed = new Date(
          Math.max(lastSegmentEnd(a).getTime(), lastSegmentEnd(b).getTime()),
        );
        upsertAggregate(
          map,
          a.userId,
          b.userId,
          minutes,
          lastPlayed,
          a.gameId ?? b.gameId,
        );
      }
    }
  }

  for (const [, signups] of signupsByEvent) {
    for (let i = 0; i < signups.length; i++) {
      const a = signups[i];
      if (a.userId === null) continue;
      for (let j = i + 1; j < signups.length; j++) {
        const b = signups[j];
        if (b.userId === null || a.userId === b.userId) continue;
        upsertAggregate(
          map,
          a.userId,
          b.userId,
          0,
          new Date(),
          a.gameId ?? b.gameId,
        );
      }
    }
  }

  return [...map.values()];
}
