/**
 * ROK-1771 — weekly digest v2 spotlight: candidate types, eligibility bars,
 * the pick rule and the rotation memory (spec §3). Pure logic, no DB.
 *
 * Lane L3 produces one `SpotlightCandidate` per kind from this week's data;
 * `pickSpotlight` chooses at most one; lane L5 renders the winner; the
 * service writes the winner's kind to `weekly_digest_spotlight_history`
 * (`serializeSpotlightHistory`) only after a successful send.
 */

/** The five spotlight kinds (spec §2 table A). */
export type SpotlightKind =
  'rising_game' | 'duo' | 'boss_kills' | 'common_ground' | 'marathon';

/** Tie-break order, rarest first (spec §3.2 step 3). */
export const SPOTLIGHT_RARITY: readonly SpotlightKind[] = [
  'boss_kills',
  'common_ground',
  'duo',
  'rising_game',
  'marathon',
];

/** A member named in a spotlight; already privacy-filtered by the reader. */
export interface SpotlightMember {
  userId: number;
  /** `displayName ?? username`, unescaped — the renderer bolds/escapes it. */
  name: string;
}

/** A game named in a spotlight. */
export interface SpotlightGame {
  gameId: number;
  name: string;
}

/** A1 — biggest playtime jump vs the prior week (no member names). */
export interface RisingGameCandidate {
  kind: 'rising_game';
  game: SpotlightGame;
  /** Opt-out-filtered hours in `[now-7d, now)`; may be fractional. */
  hoursThisWeek: number;
  /** Same, for `[now-14d, now-7d)`. Delta = this − prior. */
  hoursPriorWeek: number;
  /** Distinct players with hours this week. */
  playerCount: number;
}

/** A2 — the pair with the most voice overlap across this week's events. */
export interface DuoCandidate {
  kind: 'duo';
  members: readonly [SpotlightMember, SpotlightMember];
  /** Overlap minutes summed across this week's events. */
  minutesTogether: number;
  /** Distinct events the pair overlapped in. */
  eventCount: number;
  /** Titles of those events, for an optional sub-line (may be empty). */
  eventTitles: readonly string[];
}

/** A3 — successful boss pulls this week (never roster/character names). */
export interface BossKillsCandidate {
  kind: 'boss_kills';
  /** Instance name, or null when the boss-table join found none. */
  instanceName: string | null;
  /** Distinct `(encounter_id, difficulty_id)` kills ended in the window. */
  killCount: number;
  /** Boss names killed for the first time ever (same guild_key), ≤3. */
  firstEverKills: readonly string[];
}

/** A4 — a public, non-standalone lineup decided this week. */
export interface CommonGroundCandidate {
  kind: 'common_ground';
  lineupId: number;
  winner: SpotlightGame & { votes: number };
  /** All votes cast on the lineup (anonymous counts). */
  totalVotes: number;
  runnerUp: (SpotlightGame & { votes: number }) | null;
}

/** A5 — the longest attended event that ended this week (names an event). */
export interface MarathonCandidate {
  kind: 'marathon';
  eventId: number;
  eventTitle: string;
  durationMinutes: number;
  attendeeCount: number;
}

export type SpotlightCandidate =
  | RisingGameCandidate
  | DuoCandidate
  | BossKillsCandidate
  | CommonGroundCandidate
  | MarathonCandidate;

/** Eligibility bars (spec §3.1, operator ruling Q3). Constants, not settings. */
export const SPOTLIGHT_BARS = {
  rising_game: { minHours: 5, minDeltaHours: 3, minPlayers: 2 },
  duo: { minMinutes: 120, minEvents: 2 },
  boss_kills: { minKills: 1 },
  common_ground: { minVotes: 3 },
  marathon: { minMinutes: 180 },
} as const;

/** Score = metric ÷ bar, capped so kinds compare as "how far over the bar". */
export const SPOTLIGHT_MAX_SCORE = 5;

/** Hours gained vs the prior week (negative when playtime dropped). */
export function risingGameDeltaHours(c: RisingGameCandidate): number {
  return c.hoursThisWeek - c.hoursPriorWeek;
}

/** True when the candidate clears every bar for its kind. */
export function isSpotlightEligible(c: SpotlightCandidate): boolean {
  switch (c.kind) {
    case 'rising_game': {
      const bar = SPOTLIGHT_BARS.rising_game;
      return (
        c.hoursThisWeek >= bar.minHours &&
        risingGameDeltaHours(c) >= bar.minDeltaHours &&
        c.playerCount >= bar.minPlayers
      );
    }
    case 'duo':
      return (
        c.minutesTogether >= SPOTLIGHT_BARS.duo.minMinutes &&
        c.eventCount >= SPOTLIGHT_BARS.duo.minEvents
      );
    case 'boss_kills':
      return c.killCount >= SPOTLIGHT_BARS.boss_kills.minKills;
    case 'common_ground':
      return c.totalVotes >= SPOTLIGHT_BARS.common_ground.minVotes;
    case 'marathon':
      return c.durationMinutes >= SPOTLIGHT_BARS.marathon.minMinutes;
  }
}

function rawScore(c: SpotlightCandidate): number {
  switch (c.kind) {
    case 'rising_game':
      return risingGameDeltaHours(c) / SPOTLIGHT_BARS.rising_game.minDeltaHours;
    case 'duo':
      return c.minutesTogether / SPOTLIGHT_BARS.duo.minMinutes;
    case 'boss_kills': {
      const metric = c.killCount * (c.firstEverKills.length > 0 ? 2 : 1);
      return metric / SPOTLIGHT_BARS.boss_kills.minKills;
    }
    case 'common_ground':
      return c.totalVotes / SPOTLIGHT_BARS.common_ground.minVotes;
    case 'marathon':
      return c.durationMinutes / SPOTLIGHT_BARS.marathon.minMinutes;
  }
}

/** Metric ÷ bar, capped at `SPOTLIGHT_MAX_SCORE`. */
export function spotlightScore(c: SpotlightCandidate): number {
  return Math.min(rawScore(c), SPOTLIGHT_MAX_SCORE);
}

/** One rotation-memory entry; `week` is `YYYY-Www` (e.g. `2026-W41`). */
export interface SpotlightHistoryEntry {
  week: string;
  kind: SpotlightKind;
}

/** At most this many entries are kept, newest first. */
export const SPOTLIGHT_HISTORY_MAX = 4;

const WEEK_RE = /^\d{4}-W\d{2}$/;

/** `{ year: 2026, week: 1 }` → `2026-W01` (the digest dedup key's format). */
export function formatSpotlightWeek(w: { year: number; week: number }): string {
  return `${w.year}-W${String(w.week).padStart(2, '0')}`;
}

function isKind(value: unknown): value is SpotlightKind {
  return SPOTLIGHT_RARITY.some((k) => k === value);
}

function toEntry(value: unknown): SpotlightHistoryEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const week: unknown = Reflect.get(value, 'week');
  const kind: unknown = Reflect.get(value, 'kind');
  if (typeof week !== 'string' || !WEEK_RE.test(week)) return null;
  return isKind(kind) ? { week, kind } : null;
}

function newestFirst(
  entries: readonly SpotlightHistoryEntry[],
): SpotlightHistoryEntry[] {
  return [...entries]
    .sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0))
    .slice(0, SPOTLIGHT_HISTORY_MAX);
}

/** Parse the stored setting. Malformed JSON / non-array → `[]`, never throws. */
export function parseSpotlightHistory(
  raw: string | null | undefined,
): SpotlightHistoryEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries = parsed
    .map(toEntry)
    .filter((e): e is SpotlightHistoryEntry => e !== null);
  return newestFirst(entries);
}

/** Record `entry` (replacing any same-week entry) → JSON for the setting. */
export function serializeSpotlightHistory(
  history: readonly SpotlightHistoryEntry[],
  entry: SpotlightHistoryEntry,
): string {
  const others = history.filter((e) => e.week !== entry.week);
  return JSON.stringify(newestFirst([entry, ...others]));
}

/** Kind of the newest entry strictly before `week` (same week is ignored). */
export function lastSpotlightKind(
  history: readonly SpotlightHistoryEntry[],
  week: string,
): SpotlightKind | null {
  const prior = newestFirst(history.filter((e) => e.week < week));
  return prior[0]?.kind ?? null;
}

function rarity(kind: SpotlightKind): number {
  return SPOTLIGHT_RARITY.indexOf(kind);
}

/**
 * Spec §3.2: drop ineligible candidates and last week's kind; highest score
 * wins; ties go to the rarer kind. Nothing left → null (ruling Q1: no
 * repeat even when last week's kind is the only eligible one).
 */
export function pickSpotlight(
  candidates: readonly SpotlightCandidate[],
  history: readonly SpotlightHistoryEntry[],
  week: string,
): SpotlightCandidate | null {
  const excluded = lastSpotlightKind(history, week);
  const ranked = candidates
    .filter((c) => c.kind !== excluded && isSpotlightEligible(c))
    .map((c) => ({ c, score: spotlightScore(c) }))
    .sort((a, b) => b.score - a.score || rarity(a.c.kind) - rarity(b.c.kind));
  return ranked[0]?.c ?? null;
}
