/**
 * ROK-1957 D-10 — party slot signatures `origin:race:n`, where `n` is the
 * 1-based ordinal among non-summons with the same `(origin, race)` in save
 * order. Classes are left out (a respec changes them). Summons are not
 * claimable, so they get `null`.
 */
import type { Bg3PartyMember } from '@raid-ledger/contract';

export type Bg3SlotMember = Pick<
  Bg3PartyMember,
  'origin' | 'race' | 'isSummon'
>;

/** One entry per member, aligned with `party`. */
export function slotKeys(party: readonly Bg3SlotMember[]): (string | null)[] {
  const seen = new Map<string, number>();
  return party.map((m) => {
    if (m.isSummon) return null;
    const pair = `${m.origin}:${m.race}`;
    const n = (seen.get(pair) ?? 0) + 1;
    seen.set(pair, n);
    return `${pair}:${n}`;
  });
}
