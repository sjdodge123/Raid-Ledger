import { sql } from 'drizzle-orm';
import { guildNameKey, type AddonImportTx } from './addon-import-apply.types';
import type { DecodedAddonPaste } from './addon-import.decoder';

/**
 * ROK-1794 review P3 — THE lock order for an addon-import transaction.
 * Every advisory lock an import apply takes is listed here, in order:
 *
 *   1. the GUID pin lock   `(ADDON_GUID_LOCK_CLASS, hashtext('game:region:guid'))`
 *   2. the guild-import lock `hashtext('guild-import:game:region:nameKey')`
 *
 * Both apply routes (per-character and create) take them up front, in this
 * order, through `lockImportScope`, before any section runs. The later
 * per-step calls (`assertGuidFree`, `lockGuildImport`) then re-enter a lock
 * this session already holds, which never blocks — so two imports racing on
 * the same GUID + guild can no longer each hold one and wait on the other
 * (Postgres 40P01 → a 500). The admin unlink takes only (1). A new lock
 * joins this list, here, and `lockImportScope` takes it in its place.
 * Previews take none (read-only).
 */
export const ADDON_GUID_LOCK_CLASS = 17241;

/** (1) — the GUID pin lock (`assertGuidFree`, the create route, unlink). */
export async function lockAddonGuid(
  tx: AddonImportTx,
  gameId: number,
  region: string,
  guid: string,
): Promise<void> {
  const key = `${gameId}:${region}:${guid}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${ADDON_GUID_LOCK_CLASS}::int4, hashtext(${key}))`,
  );
}

/** (2) — one guild's import lock (`lockGuildImport`). */
export async function lockGuildName(
  tx: AddonImportTx,
  gameId: number,
  region: string,
  nameKey: string,
): Promise<void> {
  const key = `guild-import:${gameId}:${region}:${nameKey}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

/** What an apply will lock: its GUID (when it pins or creates) + guild. */
export interface ImportLockScope {
  gameId: number;
  region: string;
  /** The GUID the apply pins or resolves by; null when it pins none. */
  guid: string | null;
  paste: DecodedAddonPaste;
}

/** Take every lock the apply will need, in THE order above. */
export async function lockImportScope(
  tx: AddonImportTx,
  scope: ImportLockScope,
): Promise<void> {
  const { gameId, region, guid, paste } = scope;
  if (guid) await lockAddonGuid(tx, gameId, region, guid);
  const guild = paste.sections.guild;
  if (guild) {
    const nameKey = guildNameKey(guild.payload.data.name);
    await lockGuildName(tx, gameId, region, nameKey);
  }
}
