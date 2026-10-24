import type { ValheimPortalsMessage } from '@raid-ledger/contract';
import type * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import type { ArmorySnapshot } from './valheim-armory.mappers';
import {
  clearScanPortals,
  insertPortals,
  upsertPortalScan,
} from './valheim-portals.repository';

/** The scan header row (D2); `portal_count` is the stored total. */
export function toPortalScanValues(
  snap: ArmorySnapshot,
  msg: ValheimPortalsMessage,
): schema.NewValheimPortalScan {
  return {
    pelicanServerId: snap.pelicanServerId,
    worldUid: msg.worldUid,
    gameVersion: msg.gameVersion,
    capturedAt: new Date(msg.capturedAt),
    omitted: msg.omitted,
    portalCount: msg.portals.length,
    sourceSnapshotId: snap.id,
  };
}

/** Portal rows for one scan; prefab and tag stored verbatim, `y` may be null. */
export function toPortalRows(
  msg: ValheimPortalsMessage,
  scanId: number,
  pelicanServerId: number,
): schema.NewValheimPortalRow[] {
  return msg.portals.map((p) => ({
    scanId,
    pelicanServerId,
    prefab: p.prefab,
    x: p.x,
    y: p.y,
    z: p.z,
    tag: p.tag,
  }));
}

/**
 * ROK-1946 D3: latest-wins replace of a world's portals, on the importer's
 * one transaction. Returns false when the stored scan is as new or newer
 * (`skipped_stale`, nothing written) — an empty newer scan still wins.
 */
export async function importPortals(
  tx: ValheimLinkTx,
  snap: ArmorySnapshot,
  msg: ValheimPortalsMessage,
): Promise<boolean> {
  const scanId = await upsertPortalScan(tx, toPortalScanValues(snap, msg));
  if (scanId === null) return false;
  await clearScanPortals(tx, scanId);
  await insertPortals(tx, toPortalRows(msg, scanId, snap.pelicanServerId));
  return true;
}
