import { and, eq, sql } from 'drizzle-orm';
import type { WowRegion } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { GUID_ALREADY_LINKED_MESSAGE } from './addon-import-binding.apply';
import { AddonImportError } from './addon-import.errors';
import type { AddonImportTx } from './addon-import-apply.types';
import { findLoadedCharacter, type LoadedCharacter } from './addon-import.run';

/**
 * ROK-1738 D2 — where does a LedgerLink export land for this user?
 * (1) GUID holder on (game, region, guid): own → update; another player's →
 *     `INVALID_PAYLOAD` + the unchanged ROK-1724 "already linked" copy.
 * (2) No holder → name claim on (game, region, lower(name)): another
 *     player's → `CHARACTER_CLAIMED`; own → update (ruling Q1 — the apply
 *     pins the GUID; a different stored GUID → `GUID_CONFIRM_REQUIRED`).
 * (3) Neither → create.
 * Read-only. The apply path re-runs it under the GUID advisory lock (D4).
 */

export type ImportTarget =
  | { action: 'create' }
  | { action: 'update'; character: LoadedCharacter };

export interface ImportTargetQuery {
  userId: number;
  gameId: number;
  region: WowRegion;
  guid: string;
  /** The export's resolved, normalised name (`resolveExportName`). */
  name: string;
}

export async function resolveImportTarget(
  db: AddonImportTx,
  q: ImportTargetQuery,
): Promise<ImportTarget> {
  const sameSlot = [
    eq(schema.characters.gameId, q.gameId),
    eq(schema.characters.region, q.region),
  ];
  const byGuid = await findLoadedCharacter(
    db,
    and(...sameSlot, eq(schema.characters.addonGuid, q.guid)),
  );
  if (byGuid) {
    if (byGuid.userId === q.userId) {
      return { action: 'update', character: byGuid.character };
    }
    throw new AddonImportError('INVALID_PAYLOAD', GUID_ALREADY_LINKED_MESSAGE);
  }
  const byName = await findLoadedCharacter(
    db,
    and(
      ...sameSlot,
      sql`lower(${schema.characters.name}) = lower(${q.name})`,
    ),
  );
  if (!byName) return { action: 'create' };
  if (byName.userId !== q.userId) {
    throw new AddonImportError('CHARACTER_CLAIMED');
  }
  return { action: 'update', character: byName.character };
}
