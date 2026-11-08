import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { blizzardIdLink } from '../guilds/guild-link.predicates';
import type { AddonImportTx } from './addon-import-apply.types';
import { logExternalIdLinked } from './external-id.audit';

/**
 * ROK-2115 (Codex r2 P1) — a GUID holder wins its roster row over every
 * Blizzard-id character (Ruling 3). When the holder stops holding it
 * (character delete, admin unlink, GUID repin, owner wiped), a suppressed
 * Blizzard-id character becomes the row's winner with an OLD link audit, so
 * a ROK-1794 member grant staff made for the GUID holder would be honoured
 * for the new winner's owner. Each newly winning character gets a fresh
 * `external_id_linked` (via `guid_released`) dated now: later than any grant
 * on the row, so staff must re-grant to confirm it.
 *
 * Call AFTER the delete / clear / repin, on the same tx: arm B only stops
 * being suppressed once the holder is gone.
 */

const { guilds, guildMembers, characters } = schema;

/** A GUID a character stopped holding, scoped like arm A (game + region). */
export interface ReleasedGuid {
  guid: string;
  gameId: number;
  /** The holder's region; null = it matched rows of any region. */
  region: string | null;
}

interface GuidHolderRow {
  addonGuid: string | null;
  gameId: number;
  region: string | null;
}

/** The GUID a (deleted or about-to-change) character held; null if none. */
export function releasedGuidOf(row: GuidHolderRow): ReleasedGuid | null {
  if (row.addonGuid === null) return null;
  return { guid: row.addonGuid, gameId: row.gameId, region: row.region };
}

/** The GUIDs a user's characters hold — read BEFORE the user is wiped. */
export async function heldGuidsOf(
  tx: AddonImportTx,
  userId: number,
): Promise<ReleasedGuid[]> {
  const rows = await tx
    .select({
      addonGuid: characters.addonGuid,
      gameId: characters.gameId,
      region: characters.region,
    })
    .from(characters)
    .where(and(eq(characters.userId, userId), isNotNull(characters.addonGuid)));
  return rows.flatMap((r) => releasedGuidOf(r) ?? []);
}

/** The roster rows the released GUID could have held (arm A's scope). */
function rowsOf(r: ReleasedGuid): SQL | undefined {
  return and(
    eq(guildMembers.guid, r.guid),
    eq(guilds.gameId, r.gameId),
    r.region === null
      ? undefined
      : sql`lower(${guilds.region}) = lower(${r.region})`,
  );
}

/**
 * Write `external_id_linked` for every character that now wins a row the
 * released GUID held through the Blizzard-id arm. @returns rows written.
 */
export async function auditGuidRelease(
  tx: AddonImportTx,
  released: ReleasedGuid | null,
  actorId: number | null,
): Promise<number> {
  if (released === null) return 0;
  const winners = await tx
    .selectDistinct({
      id: characters.id,
      userId: characters.userId,
      externalId: characters.externalId,
      gameId: characters.gameId,
      region: characters.region,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, blizzardIdLink())
    .where(rowsOf(released));
  for (const w of winners) {
    const { id, userId, ...rest } = w;
    const entry = { ...rest, actorId, ownerId: userId, characterId: id };
    await logExternalIdLinked(tx, { ...entry, via: 'guid_released' }, null);
  }
  return winners.length;
}

/** {@link auditGuidRelease} for each GUID a wiped user's characters held. */
export async function auditGuidReleases(
  tx: AddonImportTx,
  released: ReleasedGuid[],
  actorId: number | null,
): Promise<void> {
  for (const r of released) await auditGuidRelease(tx, r, actorId);
}
