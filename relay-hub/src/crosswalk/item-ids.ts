import {
  buildGameNameLockKeys,
  type CrosswalkContributionItem,
  type CrosswalkKind,
} from '@raid-ledger/contract';
import type { StoredProvenance } from './provenance';

/** The strong id kinds an instance contributes. */
export type ItemIdKind = Extract<
  CrosswalkKind,
  'steam_app_id' | 'igdb_id' | 'itad_uuid'
>;

/** One contributed id in its stored form (L4). */
export interface ItemId {
  readonly kind: ItemIdKind;
  readonly value: string;
  readonly provenance: StoredProvenance;
}

/**
 * Item → ids in priority order (steam, igdb, itad). Ints become `String(n)`,
 * the ITAD UUID is lower-cased; a missing provenance is stored as NULL.
 */
export function itemIds(item: CrosswalkContributionItem): ItemId[] {
  const p = item.provenance;
  const out: ItemId[] = [];
  if (item.steamAppId !== undefined) {
    out.push(id('steam_app_id', String(item.steamAppId), p.steamAppId));
  }
  if (item.igdbId !== undefined) {
    out.push(id('igdb_id', String(item.igdbId), p.igdbId));
  }
  if (item.itadUuid !== undefined) {
    out.push(id('itad_uuid', item.itadUuid.toLowerCase(), p.itadUuid));
  }
  return out;
}

function id(
  kind: ItemIdKind,
  value: string,
  provenance: StoredProvenance | undefined,
): ItemId {
  return { kind, value, provenance: provenance ?? null };
}

/** Advisory-lock key of one id: `<kind>:<value>`. */
export function idLockKey(itemId: ItemId): string {
  return `${itemId.kind}:${itemId.value}`;
}

/** L1: normalized-name keys plus one key per id, de-duplicated and sorted. */
export function lockKeysFor(item: CrosswalkContributionItem): string[] {
  const keys = new Set<string>([
    ...buildGameNameLockKeys(item.name),
    ...itemIds(item).map(idLockKey),
  ]);
  return [...keys].sort();
}
