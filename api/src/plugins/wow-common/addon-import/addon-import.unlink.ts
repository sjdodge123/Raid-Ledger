import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AddonCharacterUnlinkResult } from './addon-import.unlink.types';
import { autoPromoteAfterDelete } from '../../../characters/characters-crud.helpers';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { ADDON_GUID_LOCK_CLASS } from './addon-import-binding.apply';
import type { AddonImportTx } from './addon-import-apply.types';
import { logGuidAudit } from './addon-import.guid-audit';
import { auditGuidRelease } from './external-id.guid-release';
import { NotificationService } from '../../../notifications/notification.service';
import {
  lockCharacter,
  rosterOriginOf,
  type RosterOrigin,
} from '../guilds/roster-claim/character-owner.admin.tx';
import {
  removedNotice,
  sendOwnerNotices,
} from '../guilds/roster-claim/character-owner.notify';
import { logCharacterClaimAudit } from '../guilds/roster-claim/roster-claim.audit';

/**
 * ROK-1756 (option B) — admin recovery for a squatted in-game character.
 * Export strings are unsigned, so whoever imports a GUID first holds it (and
 * the character's name on that region). Unlinking REMOVES the holder's
 * GUID-linked character — `characters.user_id` is NOT NULL and the squat
 * also holds the name claim, so clearing only the GUID would still answer
 * `CHARACTER_CLAIMED` to the rightful owner. The removal is audited.
 * ROK-2128 widens it to roster-claimed rows (with or without a GUID): they
 * are deleted too and reappear in the pick list; the owner is notified.
 */
const characterById = (tx: AddonImportTx, id: string) =>
  tx
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, id))
    .limit(1);

type CharacterRow = typeof schema.characters.$inferSelect;

/** Owner-conditional by-id filter: never deletes a row moved to someone else. */
const ownedBy = (row: CharacterRow) =>
  and(
    eq(schema.characters.id, row.id),
    eq(schema.characters.userId, row.userId),
  );

/** Same lock class + key as the import apply paths: serialises with them. */
async function lockGuid(tx: AddonImportTx, row: CharacterRow, guid: string) {
  const key = `${row.gameId}:${row.region}:${guid}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${ADDON_GUID_LOCK_CLASS}::int4, hashtext(${key}))`,
  );
}

/** GUID path (ROK-1756): lock (1), re-check, delete, GUID audit. */
async function unlinkGuidRow(
  tx: AddonImportTx,
  adminId: number,
  row: CharacterRow,
  guid: string,
): Promise<void> {
  await lockGuid(tx, row, guid);
  // A concurrent apply or admin Change owner (which keeps the GUID) may have
  // changed the row between the read and the lock: re-check both, locked.
  const [locked] = await characterById(tx, row.id).for('update');
  if (locked?.addonGuid !== guid || locked.userId !== row.userId) {
    throw new ConflictException('That character changed; reload and retry.');
  }
  await tx.delete(schema.characters).where(ownedBy(row));
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
  // ROK-2115 Codex r2 P1: the row's new Blizzard-id winner is a fresh link.
  await auditGuidRelease(
    tx,
    { guid, gameId: row.gameId, region: row.region },
    adminId,
  );
}

/** ROK-2128 (FLAG 6) — a roster-claimed row: delete it, audit `admin_unlinked_roster`. */
async function unlinkRosterRow(
  tx: AddonImportTx,
  adminId: number,
  row: CharacterRow,
  origin: RosterOrigin,
): Promise<void> {
  if (row.addonGuid) await unlinkGuidRow(tx, adminId, row, row.addonGuid);
  else {
    await lockCharacter(tx, row);
    await tx.delete(schema.characters).where(ownedBy(row));
  }
  await logCharacterClaimAudit(tx, {
    action: 'admin_unlinked_roster',
    ownerId: row.userId,
    actorId: adminId,
    characterId: row.id,
    name: row.name,
    ...origin,
    fromUserId: row.userId,
    toUserId: null,
  });
}

async function unlinkWithin(
  tx: AddonImportTx,
  adminId: number,
  characterId: string,
  logger: Logger,
): Promise<CharacterRow> {
  const [row] = await characterById(tx, characterId);
  if (!row) throw new NotFoundException('Character not found');
  const origin = await rosterOriginOf(tx, row.id);
  if (origin) await unlinkRosterRow(tx, adminId, row, origin);
  else if (row.addonGuid) await unlinkGuidRow(tx, adminId, row, row.addonGuid);
  else
    throw new ConflictException(
      'That character is not linked to an in-game character.',
    );
  // Same tx: it sees the delete uncommitted, and a failure rolls the delete
  // back instead of leaving the user with no main behind a 500.
  await autoPromoteAfterDelete(tx, row.userId, row.gameId, logger);
  return row;
}

@Injectable()
export class AddonCharacterUnlinkService {
  private readonly logger = new Logger(AddonCharacterUnlinkService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationService,
  ) {}

  async unlink(
    adminId: number,
    characterId: string,
  ): Promise<AddonCharacterUnlinkResult> {
    const row = await this.db.transaction((tx) =>
      unlinkWithin(tx, adminId, characterId, this.logger),
    );
    this.logger.log(
      `Admin ${adminId} unlinked character ${row.id} (user ${row.userId})`,
    );
    // ROK-2128 (FLAG 7) — after commit, best-effort.
    await sendOwnerNotices(
      this.notifications,
      [removedNotice(row.userId, row.name, row.id)],
      this.logger,
    );
    return { characterId: row.id, userId: row.userId };
  }
}
