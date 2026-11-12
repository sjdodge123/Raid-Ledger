/**
 * ROK-2187 — pure helpers for GG <year>: the year window in the community
 * timezone, the activity tier (R4) and the public share slug (Q5).
 */
import { randomBytes } from 'node:crypto';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import type { GgActivityTier, GgCardEnvelope } from '@raid-ledger/contract';
import { zonedHourToUtc } from '../../../lfg/lfg-zoned-time.helpers';
import { safeTimeZone } from '../../../notifications/weekly-digest-schedule.helpers';
import type { GgCardWindow } from './gg-card.registry';

/**
 * The GG window for `year`: Jan 1 00:00 in `timeZone` → `now`, capped at the
 * next Jan 1 so a past year never bleeds into the following one (F1).
 */
export function ggYearWindow(
  year: number,
  timeZone: string | null | undefined,
  now: Date,
): GgCardWindow {
  const tz = safeTimeZone(timeZone);
  const start = zonedHourToUtc(`${year}-01-01`, 0, tz);
  const nextYear = zonedHourToUtc(`${year + 1}-01-01`, 0, tz);
  const end = now.getTime() < nextYear.getTime() ? now : nextYear;
  return { start, end };
}

/** Core cards present for every user — never a signal of activity. */
const FRAME_CARDS = new Set(['intro', 'superlative', 'summary']);

/** Core cards that share one underlying signal (one data source). */
const CORE_SIGNAL_GROUP: Readonly<Record<string, string>> = {
  events: 'events',
  'on-time': 'events',
  rhythm: 'events',
  hours: 'play',
  'top-games': 'play',
  'new-games': 'play',
  voice: 'voice',
  people: 'people',
  hubs: 'hubs',
};

/** Distinct activity signals behind `cards` (frame cards excluded). */
export function ggActivitySignals(cards: readonly GgCardEnvelope[]): number {
  const signals = new Set<string>();
  for (const c of cards) {
    if (c.pluginSlug !== CORE_PLUGIN_ID) {
      signals.add(`${c.pluginSlug}:${c.cardId}`);
    } else if (!FRAME_CARDS.has(c.cardId)) {
      signals.add(CORE_SIGNAL_GROUP[c.cardId] ?? c.cardId);
    }
  }
  return signals.size;
}

/**
 * R4: no signal → `null` (no GG at all, never a zero-filled story); one
 * signal → `short` ("Welcome aboard"); two or more → `full`.
 */
export function ggActivityTier(
  cards: readonly GgCardEnvelope[],
): GgActivityTier | null {
  const n = ggActivitySignals(cards);
  if (n === 0) return null;
  return n === 1 ? 'short' : 'full';
}

/** A fresh public share slug: 128 random bits, base64url (22 chars). */
export function mintGgShareSlug(): string {
  return randomBytes(16).toString('base64url');
}
