/**
 * ROK-2138 — the ONE "Armory row" predicate: a `characters` row the Blizzard
 * Armory sync has written (an external id AND a sync stamp). Shared by the
 * fact resolver (`rowOrigin` labels such a row `blizzard`) and the LedgerLink
 * binding (which then only fills the row's gaps), so the two never disagree
 * about a row that carries an external id but never synced.
 */
export interface ArmoryLinkFields {
  externalId?: string | null | undefined;
  lastSyncedAt?: Date | null | undefined;
}

export function isArmoryRow(row: ArmoryLinkFields): boolean {
  return (
    (row.externalId ?? null) !== null && (row.lastSyncedAt ?? null) !== null
  );
}
