import {
  GG_YOUTUBE_ID_RE,
  type GgHoursCard,
  type GgTopGamesCard,
} from '@raid-ledger/contract';

/** One `game_activity_rollups` month row of the user's year, with its game. */
export interface GgRollupRow {
  gameId: number;
  name: string;
  coverUrl: string | null;
  /** 1–12 — the rollup's (UTC `date_trunc`) calendar month. */
  month: number;
  seconds: number;
}

/** A game's playtime over the year (or one month). */
export interface GgGameTotal {
  gameId: number;
  name: string;
  coverUrl: string | null;
  seconds: number;
}

/** The IGDB media `games` stores for one game. */
export interface GgGameMedia {
  gameId: number;
  screenshots: string[];
  videos: { name: string; videoId: string }[];
}

/** Top-games caps (contract: 5 games, 4 screenshots per game). */
export const GG_TOP_GAMES_LIMIT = 5;
const SCREENSHOTS_PER_GAME = 4;
const NAME_MAX = 120;

const bySecondsThenId = (a: GgGameTotal, b: GgGameTotal): number =>
  b.seconds - a.seconds || a.gameId - b.gameId;

/** Contract `gameRef` (name clipped to the schema's 120 chars). */
export function gameRefOf(t: GgGameTotal): {
  gameId: number;
  name: string;
  coverUrl: string | null;
} {
  return {
    gameId: t.gameId,
    name: t.name.slice(0, NAME_MAX),
    coverUrl: t.coverUrl,
  };
}

/** Playtime per game, largest first (ties → smaller id); zero-second games dropped. */
export function totalsByGame(rows: readonly GgRollupRow[]): GgGameTotal[] {
  const totals = new Map<number, GgGameTotal>();
  for (const r of rows) {
    const t = totals.get(r.gameId);
    if (t) t.seconds += r.seconds;
    else
      totals.set(r.gameId, {
        gameId: r.gameId,
        name: r.name,
        coverUrl: r.coverUrl,
        seconds: r.seconds,
      });
  }
  return [...totals.values()]
    .filter((t) => t.seconds > 0)
    .sort(bySecondsThenId);
}

/** Each month's most-played game (ties → smaller id), months in order. */
export function topGamePerMonth(
  rows: readonly GgRollupRow[],
): (GgGameTotal & { month: number })[] {
  const best = new Map<number, GgRollupRow>();
  for (const r of rows) {
    if (r.seconds <= 0) continue;
    const cur = best.get(r.month);
    if (!cur || bySecondsThenId(r, cur) < 0) best.set(r.month, r);
  }
  return [...best.values()]
    .sort((a, b) => a.month - b.month)
    .map((r) => ({
      gameId: r.gameId,
      name: r.name,
      coverUrl: r.coverUrl,
      month: r.month,
      seconds: r.seconds,
    }));
}

/** Card 5 (metrics 5, 7); `null` without any rolled-up playtime. */
export function summarizeHours(
  rows: readonly GgRollupRow[],
  habits: { sessions: number; nightSessions: number },
): GgHoursCard | null {
  const totals = totalsByGame(rows);
  if (totals.length === 0) return null;
  const totalSeconds = totals.reduce((sum, t) => sum + t.seconds, 0);
  const share =
    habits.sessions > 0
      ? { nightOwlShare: habits.nightSessions / habits.sessions }
      : {};
  return { totalSeconds, gamesPlayed: totals.length, ...share };
}

/** https screenshots (≤4) + the first trailer id that is a plain YouTube id. */
export function mediaFieldsOf(media: GgGameMedia | undefined): {
  screenshots: string[];
  trailerVideoId: string | null;
} {
  const shots = (media?.screenshots ?? []).filter((u) =>
    u.startsWith('https://'),
  );
  const video = (media?.videos ?? []).find((v) =>
    GG_YOUTUBE_ID_RE.test(v.videoId),
  );
  return {
    screenshots: shots.slice(0, SCREENSHOTS_PER_GAME),
    trailerVideoId: video?.videoId ?? null,
  };
}

/** Card 6 — top 5 games with their backdrop media + each month's top game. */
export function buildTopGamesCard(
  rows: readonly GgRollupRow[],
  media: ReadonlyMap<number, GgGameMedia>,
): GgTopGamesCard | null {
  const top = totalsByGame(rows).slice(0, GG_TOP_GAMES_LIMIT);
  if (top.length === 0) return null;
  return {
    games: top.map((t) => ({
      ...gameRefOf(t),
      seconds: t.seconds,
      ...mediaFieldsOf(media.get(t.gameId)),
    })),
    byMonth: topGamePerMonth(rows).map((m) => ({
      ...gameRefOf(m),
      month: m.month,
      seconds: m.seconds,
    })),
  };
}
