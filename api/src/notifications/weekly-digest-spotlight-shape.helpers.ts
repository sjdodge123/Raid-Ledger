/**
 * ROK-1771 L3 — pure shaping for the spotlight candidate reads in
 * `weekly-digest-spotlight-sources.helpers.ts`: raw SQL rows in, a
 * `SpotlightCandidate` (raw facts only) or `null` out. No eligibility or
 * scoring here — `pickSpotlight` owns both.
 */
import type {
  BossKillsCandidate,
  CommonGroundCandidate,
  MarathonCandidate,
  RisingGameCandidate,
} from './weekly-digest-spotlight.helpers';

/** postgres-js returns un-cast bigint/numeric aggregates as text. */
export type SqlNumber = number | string | null;

/** Coerce a SQL number; null, junk and non-finite values become 0. */
export function toNumber(value: SqlNumber | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const SECONDS_PER_HOUR = 3600;
const MAX_FIRST_EVER = 3;

export type RisingGameRow = {
  game_id: number;
  game_name: string;
  this_seconds: SqlNumber;
  prior_seconds: SqlNumber;
  player_count: SqlNumber;
};

/** A1 — the top row (biggest delta) → candidate; no row → null. */
export function shapeRisingGame(
  row: RisingGameRow | undefined,
): RisingGameCandidate | null {
  if (!row) return null;
  return {
    kind: 'rising_game',
    game: { gameId: row.game_id, name: row.game_name },
    hoursThisWeek: toNumber(row.this_seconds) / SECONDS_PER_HOUR,
    hoursPriorWeek: toNumber(row.prior_seconds) / SECONDS_PER_HOUR,
    playerCount: toNumber(row.player_count),
  };
}

/** One distinct `(encounter_id, difficulty_id)` killed in the window. */
export type BossKillRow = {
  encounter_name: string;
  first_ever: boolean;
};

/** A3 — kill rows (oldest first) → candidate; no kills → null. */
export function shapeBossKills(
  rows: readonly BossKillRow[],
): BossKillsCandidate | null {
  if (rows.length === 0) return null;
  const firsts: string[] = [];
  for (const r of rows) {
    if (r.first_ever && !firsts.includes(r.encounter_name)) {
      firsts.push(r.encounter_name);
    }
  }
  return {
    kind: 'boss_kills',
    // The pull's instance_id is the in-game map id (Molten Core = 409) and
    // wow_classic_bosses keys on the Journal id (Molten Core = 741), with no
    // instance-name column anywhere — so there is no reliable name to join.
    instanceName: null,
    killCount: rows.length,
    firstEverKills: firsts.slice(0, MAX_FIRST_EVER),
  };
}

export type DecidedLineupRow = {
  lineup_id: number;
  decided_game_id: number;
  decided_game_name: string;
};

export interface GameVotes {
  gameId: number;
  voteCount: number;
}

/** The highest-voted game other than the winner (ties → lower game id). */
export function runnerUpVotes(
  votes: readonly GameVotes[],
  winnerId: number,
): GameVotes | null {
  const others = votes
    .filter((v) => v.gameId !== winnerId && v.voteCount > 0)
    .sort((a, b) => b.voteCount - a.voteCount || a.gameId - b.gameId);
  return others[0] ?? null;
}

/** A4 — decided lineup + per-game vote counts → candidate. */
export function shapeCommonGround(
  lineup: DecidedLineupRow | undefined,
  votes: readonly GameVotes[],
  runnerUpName: string | null,
): CommonGroundCandidate | null {
  if (!lineup) return null;
  const winnerId = lineup.decided_game_id;
  const winnerVotes = votes.find((v) => v.gameId === winnerId);
  const second = runnerUpVotes(votes, winnerId);
  return {
    kind: 'common_ground',
    lineupId: lineup.lineup_id,
    winner: {
      gameId: winnerId,
      name: lineup.decided_game_name,
      votes: winnerVotes?.voteCount ?? 0,
    },
    totalVotes: votes.reduce((sum, v) => sum + v.voteCount, 0),
    runnerUp:
      second && runnerUpName !== null
        ? { gameId: second.gameId, name: runnerUpName, votes: second.voteCount }
        : null,
  };
}

export type MarathonRow = {
  event_id: number;
  event_title: string;
  duration_minutes: SqlNumber;
  attendee_count: SqlNumber;
};

/** A5 — the longest attended event → candidate; none → null. */
export function shapeMarathon(
  row: MarathonRow | undefined,
): MarathonCandidate | null {
  if (!row) return null;
  return {
    kind: 'marathon',
    eventId: row.event_id,
    eventTitle: row.event_title,
    durationMinutes: Math.round(toNumber(row.duration_minutes)),
    attendeeCount: toNumber(row.attendee_count),
  };
}
