import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AddonImportStatus, WowRegion } from '@raid-ledger/contract';
import type * as schema from '../../../drizzle/schema';

/** The transaction the service opens and hands to every apply step. */
export type AddonImportTx = PostgresJsDatabase<typeof schema>;

/**
 * Everything an apply step needs besides the payload. B3 fills it from the
 * owned character (`CharactersService.findOne`) after the binding passed.
 */
export interface AddonApplyContext {
  tx: AddonImportTx;
  userId: number;
  characterId: string;
  gameId: number;
  region: WowRegion;
  /** `DecodedAddonImport.sha256` — stored, never the string itself. */
  sha256: string;
}

/** A section's outcome: `preview` on dry runs, else applied/noop/stale. */
export interface AddonSectionOutcome<S> {
  status: AddonImportStatus;
  summary: S;
}

/** Unix seconds (addon) → Date. */
export const fromUnix = (seconds: number): Date => new Date(seconds * 1000);

/** lower(name), NFC + trimmed — the realm-less guild key and pull guild key. */
export function guildNameKey(name: string | undefined): string {
  return (name ?? '').normalize('NFC').trim().toLowerCase().slice(0, 64);
}
