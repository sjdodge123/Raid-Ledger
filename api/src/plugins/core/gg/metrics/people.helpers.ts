import {
  voiceOverlapMinutes,
  type VoiceSessionRow,
} from '../../../../taste-profile/co-play-graph.helpers';

/** A linked user's voice session on one of the year's counted events. */
export interface GgCoVoiceRow {
  eventId: number;
  userId: number;
  segments: VoiceSessionRow['segments'];
}

/** A live signup on one of the year's counted events. */
export interface GgCoSignupRow {
  eventId: number;
  userId: number;
}

/** One co-player of the owner's year. */
export interface GgCoPlayer {
  userId: number;
  /** Distinct events shared by voice overlap or both being signed up. */
  sharedEvents: number;
  /** Voice overlap (whole minutes, as the co-play graph counts it) in seconds. */
  sharedVoiceSeconds: number;
}

interface Tally {
  events: Set<number>;
  seconds: number;
}

function tallyOf(map: Map<number, Tally>, userId: number): Tally {
  const t = map.get(userId) ?? { events: new Set<number>(), seconds: 0 };
  map.set(userId, t);
  return t;
}

const asSession = (r: GgCoVoiceRow): VoiceSessionRow => ({
  ...r,
  gameId: null,
});

function tallyVoice(
  me: number,
  rows: readonly GgCoVoiceRow[],
  map: Map<number, Tally>,
): void {
  const mine = rows.filter((r) => r.userId === me);
  for (const own of mine) {
    for (const other of rows) {
      if (other.userId === me || other.eventId !== own.eventId) continue;
      const minutes = voiceOverlapMinutes(asSession(own), asSession(other));
      if (minutes === 0) continue;
      const t = tallyOf(map, other.userId);
      t.events.add(own.eventId);
      t.seconds += minutes * 60;
    }
  }
}

function tallySignups(
  me: number,
  rows: readonly GgCoSignupRow[],
  map: Map<number, Tally>,
): void {
  const myEvents = new Set(
    rows.filter((r) => r.userId === me).map((r) => r.eventId),
  );
  for (const r of rows) {
    if (r.userId !== me && myEvents.has(r.eventId))
      tallyOf(map, r.userId).events.add(r.eventId);
  }
}

/**
 * Metric 9 (F3) — the owner's co-players for the year, recomputed from the
 * year's voice sessions + signups (never the all-time `player_co_play`).
 * Ranked by shared events, then shared voice time, then user id.
 */
export function rankCoPlayers(
  me: number,
  voice: readonly GgCoVoiceRow[],
  signups: readonly GgCoSignupRow[],
): GgCoPlayer[] {
  const map = new Map<number, Tally>();
  tallyVoice(me, voice, map);
  tallySignups(me, signups, map);
  return [...map.entries()]
    .map(([userId, t]) => ({
      userId,
      sharedEvents: t.events.size,
      sharedVoiceSeconds: t.seconds,
    }))
    .sort(
      (a, b) =>
        b.sharedEvents - a.sharedEvents ||
        b.sharedVoiceSeconds - a.sharedVoiceSeconds ||
        a.userId - b.userId,
    );
}
