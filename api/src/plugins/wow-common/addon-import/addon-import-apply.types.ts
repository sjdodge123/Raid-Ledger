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
  /**
   * ROK-1917 final P2 — the GUID the binding pins on this character once the
   * sections ran (`AddonBindingResult.pinGuid`); the raid takeover trusts it.
   */
  pendingGuid?: string | null;
}

/**
 * ROK-2066 — an applied roster change big enough for staff to see: window
 * totals against the guild's roster at the window's start (`live`).
 */
export interface RosterFlag {
  guildId: number;
  removed: number;
  added: number;
  live: number;
  dropsEditor: boolean;
}

/** A section's outcome: `preview` on dry runs, else applied/noop/stale. */
export interface AddonSectionOutcome<S> {
  status: AddonImportStatus;
  summary: S;
  /** Set by an applied guild section; flagged to staff after commit. */
  rosterFlag?: RosterFlag;
}

/** Unix seconds (addon) → Date. */
export const fromUnix = (seconds: number): Date => new Date(seconds * 1000);

/** lower(name), NFC + trimmed — the realm-less guild key and pull guild key. */
export function guildNameKey(name: string | undefined): string {
  return (name ?? '').normalize('NFC').trim().toLowerCase().slice(0, 64);
}
