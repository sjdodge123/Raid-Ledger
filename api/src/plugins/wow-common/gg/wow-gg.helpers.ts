/**
 * ROK-2187 metric 12 — pure aggregation for the WoW "levels dinged" GG card.
 * The producer hands over one row per (ding event, linked character); this
 * folds them into the card, counting each event once.
 */
import type { GgWowLevelsCard } from '@raid-ledger/contract';

/** The schema's cap on listed characters. */
const MAX_CHARACTERS = 20;

/** One in-window ding of a character the user owns. */
export interface WowYearDingRow {
  eventId: number;
  characterId: string;
  name: string;
  className: string | null;
  fromLevel: number;
  toLevel: number;
}

type CharacterLine = GgWowLevelsCard['characters'][number];

interface Tally {
  name: string;
  className: string | null;
  fromLevel: number;
  maxLevel: number;
  dings: number;
}

/** Each event once (the first row wins), keyed per character. */
function tallyByCharacter(rows: readonly WowYearDingRow[]): Map<string, Tally> {
  const seen = new Set<number>();
  const tallies = new Map<string, Tally>();
  for (const r of rows) {
    if (seen.has(r.eventId)) continue;
    seen.add(r.eventId);
    const t = tallies.get(r.characterId);
    if (t === undefined) {
      tallies.set(r.characterId, {
        name: r.name,
        className: r.className,
        fromLevel: r.fromLevel,
        maxLevel: r.toLevel,
        dings: 1,
      });
      continue;
    }
    t.dings += 1;
    t.fromLevel = Math.min(t.fromLevel, r.fromLevel);
    t.maxLevel = Math.max(t.maxLevel, r.toLevel);
  }
  return tallies;
}

/** Most dings first, then highest level, then name. */
function byDings(a: Tally, b: Tally): number {
  return (
    b.dings - a.dings || b.maxLevel - a.maxLevel || a.name.localeCompare(b.name)
  );
}

/**
 * The card from the user's in-window ding rows; `null` = no dings.
 * `fromLevel` is the level before the character's first ding of the year.
 */
export function toWowLevelsCard(
  rows: readonly WowYearDingRow[],
): GgWowLevelsCard | null {
  const tallies = [...tallyByCharacter(rows).values()];
  if (tallies.length === 0) return null;
  const totalDings = tallies.reduce((sum, t) => sum + t.dings, 0);
  const characters: CharacterLine[] = tallies
    .sort(byDings)
    .slice(0, MAX_CHARACTERS)
    .map((t) => ({ ...t }));
  return { totalDings, characters };
}
