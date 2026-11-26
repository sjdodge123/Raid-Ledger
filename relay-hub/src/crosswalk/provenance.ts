import type { CrosswalkIdProvenance } from '@raid-ledger/contract';

/** A stored id's provenance; NULL for rows that never had one. */
export type StoredProvenance = CrosswalkIdProvenance | null;

/** L5: `steam` = 2, any other value = 1, NULL = 0. */
export function provenanceRank(p: StoredProvenance): number {
  if (p === null) return 0;
  return p === 'steam' ? 2 : 1;
}

/** True only when `incoming` ranks strictly higher (equal rank: first wins). */
export function shouldRaise(
  stored: StoredProvenance,
  incoming: StoredProvenance,
): boolean {
  return provenanceRank(incoming) > provenanceRank(stored);
}
