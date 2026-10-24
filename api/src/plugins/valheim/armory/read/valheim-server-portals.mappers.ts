import type { ValheimServerPortalsResponse } from '@raid-ledger/contract';
import type * as schema from '../../../../drizzle/schema';

/**
 * ROK-1946 D6 — a stored scan (or none) → the portal-layer read body.
 * Selects only the contract keys; `tag` is user content, never logged.
 */
export function toServerPortalsResponse(
  worldUid: string | null,
  scan: schema.ValheimPortalScan | null,
  rows: schema.ValheimPortalRow[],
): ValheimServerPortalsResponse {
  return {
    worldUid: scan?.worldUid ?? worldUid,
    scannedAt: scan ? scan.capturedAt.toISOString() : null,
    omitted: scan?.omitted ?? 0,
    portals: rows.map((r) => ({
      prefab: r.prefab,
      x: r.x,
      y: r.y,
      z: r.z,
      tag: r.tag,
    })),
  };
}
