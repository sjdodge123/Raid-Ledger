import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AddonCharacterUnlinkResult } from './addon-import.unlink.types';
import { autoPromoteAfterDelete } from '../../../characters/characters-crud.helpers';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { ADDON_GUID_LOCK_CLASS } from './addon-import-binding.apply';
import type { AddonImportTx } from './addon-import-apply.types';
import { logGuidAudit } from './addon-import.guid-audit';

/**
 * ROK-1756 (option B) — admin recovery for a squatted in-game character.
 * Export strings are unsigned, so whoever imports a GUID first holds it (and
 * the character's name on that region). Unlinking REMOVES the holder's
 * GUID-linked character — `characters.user_id` is NOT NULL and the squat
 * also holds the name claim, so clearing only the GUID would still answer
 * `CHARACTER_CLAIMED` to the rightful owner. The removal is audited.
 */
const characterById = (tx: AddonImportTx, id: string) =>
  tx
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, id))
    .limit(1);

type CharacterRow = typeof schema.characters.$inferSelect;

/** Same lock class + key as the import apply paths: serialises with them. */
async function lockGuid(tx: AddonImportTx, row: CharacterRow, guid: string) {
  const key = `${row.gameId}:${row.region}:${guid}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${ADDON_GUID_LOCK_CLASS}::int4, hashtext(${key}))`,
  );
}

async function unlinkWithin(
  tx: AddonImportTx,
  adminId: number,
  characterId: string,
): Promise<CharacterRow & { addonGuid: string }> {
  const [row] = await characterById(tx, characterId);
  if (!row) throw new NotFoundException('Character not found');
  const guid = row.addonGuid;
  if (!guid) {
    throw new ConflictException(
      'That character is not linked to an in-game character.',
    );
  }
  await lockGuid(tx, row, guid);
  await tx.delete(schema.characters).where(eq(schema.characters.id, row.id));
  await logGuidAudit(tx, {
    action: 'addon_guid_admin_unlinked',
    actorId: adminId,
    ownerId: row.userId,
    characterId: row.id,
    guid,
    name: row.name,
    gameId: row.gameId,
    region: row.region,
  });
  return { ...row, addonGuid: guid };
}

@Injectable()
export class AddonCharacterUnlinkService {
  private readonly logger = new Logger(AddonCharacterUnlinkService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async unlink(
    adminId: number,
    characterId: string,
  ): Promise<AddonCharacterUnlinkResult> {
    const row = await this.db.transaction((tx) =>
      unlinkWithin(tx, adminId, characterId),
    );
    await autoPromoteAfterDelete(this.db, row.userId, row.gameId, this.logger);
    this.logger.log(
      `Admin ${adminId} unlinked character ${row.id} (user ${row.userId})`,
    );
    return { characterId: row.id, userId: row.userId, guid: row.addonGuid };
  }
}
