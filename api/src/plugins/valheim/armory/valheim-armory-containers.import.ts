import type { ValheimContainersMessage } from '@raid-ledger/contract';
import type * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import type { ArmorySnapshot } from './valheim-armory.mappers';
import {
  clearScanContainers,
  insertContainerStacks,
  insertContainers,
  upsertContainerScan,
  type InsertedContainer,
} from './valheim-containers.repository';
import { containerPublicKey } from './valheim-container-key';
import { recordContainerDay } from './valheim-container-days.repository';

export { containerPublicKey } from './valheim-container-key';

/** The scan header row (D2): counts are the stored totals for this scan. */
export function toScanValues(
  snap: ArmorySnapshot,
  msg: ValheimContainersMessage,
): schema.NewValheimContainerScan {
  return {
    pelicanServerId: snap.pelicanServerId,
    worldUid: msg.worldUid,
    gameVersion: msg.gameVersion,
    capturedAt: new Date(msg.capturedAt),
    omittedShared: msg.omittedShared,
    omittedPrivate: msg.omittedPrivate,
    containerCount: msg.containers.length,
    stackCount: msg.containers.reduce((n, c) => n + c.items.length, 0),
    sourceSnapshotId: snap.id,
  };
}

/** Container rows for one scan; `privacy` is stored as sent (`group` kept). */
export function toContainerRows(
  msg: ValheimContainersMessage,
  scanId: number,
  pelicanServerId: number,
): schema.NewValheimContainerRow[] {
  return msg.containers.map((c) => ({
    scanId,
    pelicanServerId,
    publicKey: containerPublicKey(msg.worldUid, c),
    prefab: c.prefab,
    x: c.x,
    y: c.y,
    z: c.z,
    creatorPlayerId: c.creatorPlayerId,
    privacy: c.privacy,
    vehicle: c.vehicle,
    slots: c.slots,
    usedSlots: c.usedSlots,
    unreadable: c.unreadable,
    omittedEntries: c.omittedEntries,
  }));
}

/**
 * Stack rows, joined to the inserted containers by public key. A container
 * with no inserted row is a programming error and throws (rolls back the tx).
 */
export function toStackRows(
  msg: ValheimContainersMessage,
  inserted: readonly InsertedContainer[],
): schema.NewValheimContainerStackRow[] {
  const idByKey = new Map(inserted.map((r) => [r.publicKey, r.id]));
  return msg.containers.flatMap((c) => {
    const key = containerPublicKey(msg.worldUid, c);
    const containerId = idByKey.get(key);
    if (containerId === undefined) {
      throw new Error(`containers import: no row for key ${key}`);
    }
    return c.items.map((s) => ({
      containerId,
      prefab: s.prefab,
      quality: s.quality,
      stack: s.stack,
    }));
  });
}

/**
 * D3: latest-wins replace of a world's containers, on the importer's one
 * transaction. Returns false when the stored scan is as new or newer
 * (`skipped_stale`, nothing written). Owners are never resolved here —
 * visibility is computed at read time. ROK-2014 D7: a fresh scan also
 * records its play day's end-of-day totals on the same tx; `defaultTz` is
 * the community timezone (server tz first, UTC last).
 */
export async function importContainers(
  tx: ValheimLinkTx,
  snap: ArmorySnapshot,
  msg: ValheimContainersMessage,
  defaultTz: string | null = null,
): Promise<boolean> {
  const scanId = await upsertContainerScan(tx, toScanValues(snap, msg));
  if (scanId === null) return false;
  await clearScanContainers(tx, scanId);
  const rows = toContainerRows(msg, scanId, snap.pelicanServerId);
  const inserted = await insertContainers(tx, rows);
  await insertContainerStacks(tx, toStackRows(msg, inserted));
  await recordContainerDay(tx, snap, msg, defaultTz);
  return true;
}
