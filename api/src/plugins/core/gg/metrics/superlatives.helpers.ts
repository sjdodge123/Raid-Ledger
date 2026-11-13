import type {
  GgSuperlativeCardSchema,
  GgSuperlativeKey,
} from '@raid-ledger/contract';
import type { z } from 'zod';

export type GgSuperlativeCard = z.infer<typeof GgSuperlativeCardSchema>;

/** The year's numbers the superlative is picked from. */
export interface GgSuperlativeInputs {
  attended: number;
  onTime: number;
  created: number;
  voiceSeconds: number;
  /** Game activity sessions started in the window. */
  sessions: number;
  /** …of which started 00:00–04:00 in the community tz. */
  nightSessions: number;
  /** Games whose first-ever session falls in the window. */
  newGames: number;
}

/** Award thresholds (ROK-2187 superlative picker). */
export const GG_SUPERLATIVE_THRESHOLDS = {
  onTimeMinAttended: 5,
  onTimeMinRatio: 0.9,
  plannerMinCreated: 3,
  nightOwlMinSessions: 10,
  nightOwlMinShare: 0.3,
  explorerMinNewGames: 5,
  voiceRegularMinSeconds: 36_000,
  regularMinAttended: 10,
} as const;

type Rule = [GgSuperlativeKey, (i: GgSuperlativeInputs) => number | null];
const T = GG_SUPERLATIVE_THRESHOLDS;
const atLeast = (v: number, min: number): number | null =>
  v >= min ? v : null;

/** In priority order: the first rule that returns a value wins. */
const RULES: Rule[] = [
  [
    'always-on-time',
    (i) => {
      if (i.attended < T.onTimeMinAttended) return null;
      return atLeast(i.onTime / i.attended, T.onTimeMinRatio);
    },
  ],
  ['the-planner', (i) => atLeast(i.created, T.plannerMinCreated)],
  [
    'night-owl',
    (i) => {
      if (i.sessions < T.nightOwlMinSessions) return null;
      return atLeast(i.nightSessions / i.sessions, T.nightOwlMinShare);
    },
  ],
  ['explorer', (i) => atLeast(i.newGames, T.explorerMinNewGames)],
  ['voice-regular', (i) => atLeast(i.voiceSeconds, T.voiceRegularMinSeconds)],
  ['regular', (i) => atLeast(i.attended, T.regularMinAttended)],
];

/** Card 11 — the first superlative earned, else `welcome-aboard` (short GG). */
export function pickSuperlative(i: GgSuperlativeInputs): GgSuperlativeCard {
  for (const [key, test] of RULES) {
    const value = test(i);
    if (value !== null) return { key, value };
  }
  return { key: 'welcome-aboard' };
}
