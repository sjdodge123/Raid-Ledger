import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { WowForeverSelectableRuleset } from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import { resolveAndDemoteMain } from '../../../../characters/characters-import.helpers';
import { defined } from '../../../../common/defined.helpers';
import type { AddonImportTx } from '../../addon-import/addon-import-apply.types';
import { logGuidAudit } from '../../addon-import/addon-import.guid-audit';
import {
  lockAddonGuid,
  lockClaimName,
} from '../../addon-import/addon-import.locks';
import { checkRegionClaim } from '../../wow-forever-identity.helpers';
import { inLatestSnapshot } from '../guild-membership.helpers';
import { logCharacterClaimAudit } from './roster-claim.audit';
import { isClaimableGuild, isRowUnclaimed } from './roster-claim.queries';

/**
 * ROK-2128 (D3–D5) — the one-click roster claim transaction. Order: read the
 * member → take the GUID lock (same class + key as LedgerLink applies) then
 * the name-identity lock → `FOR UPDATE` re-check visible + unclaimed →
 * identity pre-check → ONE insert that cannot violate → audits. No
 * catch-and-retry inside: postgres.js poisons the tx on a failed statement,
 * so the unique-index backstop is mapped to 409 by the caller, outside.
 */
export const CLAIMED_FIRST = 'Someone claimed this first';

const { guilds, guildMembers, characters } = schema;

type CharacterRow = typeof characters.$inferSelect;

/** What the claim needs from the roster row and its guild. */
export interface ClaimMember {
  memberId: number;
  guildId: number;
  gameId: number;
  region: string;
  name: string;
  guid: string | null;
  blizzardCharacterId: number | null;
  class: string | null;
  level: number | null;
}

export interface ClaimArgs {
  userId: number;
  memberId: number;
  ruleset: WowForeverSelectableRuleset;
  isMain: boolean;
}

/** The roster row + guild, unfiltered (404 when the row does not exist). */
export async function readMember(
  tx: AddonImportTx,
  memberId: number,
): Promise<ClaimMember> {
  const [row] = await tx
    .select({
      memberId: guildMembers.id,
      guildId: guilds.id,
      gameId: guilds.gameId,
      region: guilds.region,
      name: guildMembers.characterName,
      guid: guildMembers.guid,
      blizzardCharacterId: guildMembers.blizzardCharacterId,
      class: guildMembers.class,
      level: guildMembers.level,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(eq(guildMembers.id, memberId))
    .limit(1);
  if (!row) throw new NotFoundException('That roster character is gone');
  return row;
}

/** D5 locks, in THE order of `addon-import.locks.ts`: GUID (1), name (3). */
async function lockClaim(tx: AddonImportTx, m: ClaimMember): Promise<void> {
  if (m.guid) await lockAddonGuid(tx, m.gameId, m.region, m.guid);
  await lockClaimName(tx, m.gameId, m.region, m.name);
}

/**
 * Locked re-check: the row is still in a claimable guild's latest snapshot
 * (else 404) and still unclaimed (D2, else 409). Locks the member row.
 */
async function recheckUnderLock(
  tx: AddonImportTx,
  m: ClaimMember,
): Promise<void> {
  const unclaimed = isRowUnclaimed() ?? sql`true`;
  const [row] = await tx
    .select({ unclaimed: sql<boolean>`(${unclaimed})` })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(
      and(
        eq(guildMembers.id, m.memberId),
        isClaimableGuild(m.gameId),
        inLatestSnapshot(),
      ),
    )
    .for('update', { of: guildMembers });
  if (!row) throw new NotFoundException('That roster character is gone');
  if (!row.unclaimed) throw new ConflictException(CLAIMED_FIRST);
}

function insertValues(m: ClaimMember, args: ClaimArgs, isMain: boolean) {
  return {
    userId: args.userId,
    gameId: m.gameId,
    name: m.name,
    realm: null,
    region: m.region,
    ruleset: args.ruleset,
    class: m.class,
    level: m.level,
    addonGuid: m.guid,
    externalId:
      m.blizzardCharacterId === null ? null : String(m.blizzardCharacterId),
    isMain,
  };
}

/** Run the whole claim inside `tx`; returns the inserted character. */
export async function claimWithin(
  tx: AddonImportTx,
  m: ClaimMember,
  args: ClaimArgs,
): Promise<CharacterRow> {
  await lockClaim(tx, m);
  await recheckUnderLock(tx, m);
  const { userId } = args;
  await checkRegionClaim(tx, {
    gameId: m.gameId,
    userId,
    name: m.name,
    region: m.region,
  });
  const isMain = await resolveAndDemoteMain(tx, userId, m.gameId, args.isMain);
  const [inserted] = await tx
    .insert(characters)
    .values(insertValues(m, args, isMain))
    .returning();
  const row = defined(inserted, 'roster-claimed character');
  await auditClaim(tx, m, row);
  return row;
}

/** D4 GUID audit (`via:'roster_pick'`) + D7 `character_claim/roster_claimed`. */
async function auditClaim(
  tx: AddonImportTx,
  m: ClaimMember,
  row: CharacterRow,
): Promise<void> {
  const base = { actorId: row.userId, characterId: row.id, name: row.name };
  if (m.guid) {
    await logGuidAudit(tx, {
      ...base,
      action: 'addon_guid_claimed',
      ownerId: row.userId,
      guid: m.guid,
      gameId: m.gameId,
      region: m.region,
      via: 'roster_pick',
    });
  }
  await logCharacterClaimAudit(tx, {
    ...base,
    action: 'roster_claimed',
    ownerId: row.userId,
    guildId: m.guildId,
    memberId: m.memberId,
    fromUserId: null,
    toUserId: row.userId,
  });
}
