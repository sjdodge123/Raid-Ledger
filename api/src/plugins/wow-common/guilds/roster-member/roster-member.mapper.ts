/**
 * ROK-2149 — build the read-only, `CharacterDto`-shaped roster-member
 * payload. Professions go through the character DTO's own rule
 * (`effectiveProfessions`, no manual value) so the shape and provenance
 * match `GET /characters/:id`.
 */
import {
  CharacterEquipmentSchema,
  CharacterRoleSchema,
  ROSTER_MEMBER_CHARACTER_ID_PREFIX,
  type WowRosterMemberCharacterDto,
} from '@raid-ledger/contract';
import { z } from 'zod';
import { effectiveProfessions } from '../../../../characters/characters-professions.helpers';
import { WOW_FOREVER_VARIANT } from '../../forever-armory-switch';
import { isVerifiedSnapshot, noArmoryReason } from './roster-member.helpers';
import type {
  RosterMemberRow,
  RosterMemberSnapshot,
} from './roster-member.queries';

type Dto = WowRosterMemberCharacterDto;

const UrlSchema = z.string().url();

/** The verified snapshot's Armory fields, or all-null when there is none. */
function armoryFields(snap: RosterMemberSnapshot | null) {
  const role = CharacterRoleSchema.safeParse(snap?.role);
  const equipment = CharacterEquipmentSchema.safeParse(snap?.equipment);
  const avatar = UrlSchema.safeParse(snap?.avatarUrl);
  const ilvl = snap?.itemLevel;
  const profs = effectiveProfessions(null, snap?.armoryProfessions ?? null);
  return {
    race: snap?.race ?? null,
    spec: snap?.spec ?? null,
    role: role.success ? role.data : null,
    itemLevel: typeof ilvl === 'number' && Number.isInteger(ilvl) ? ilvl : null,
    avatarUrl: avatar.success ? avatar.data : null,
    equipment: equipment.success ? equipment.data : null,
    talents: snap?.talents ?? null,
    professions: profs.value,
    professionsSource: profs.source,
    lastSyncedAt: snap?.syncedAt?.toISOString() ?? null,
  };
}

/** Members + staff only: the roster's rank and last-seen (never the snapshot's `last_login_at`). */
function rosterOnlyFields(
  row: RosterMemberRow,
): Pick<Dto, 'rank' | 'lastSeen'> {
  const reported = row.onlineAtExport !== null || row.lastOnlineDays !== null;
  return {
    rank: { index: row.rankIndex, name: row.rankName },
    ...(reported
      ? {
          lastSeen: {
            online: row.onlineAtExport,
            lastOnlineDays: row.lastOnlineDays,
          },
        }
      : {}),
  };
}

export interface MapOptions {
  /** false for the claim-preview audience: no roster-only keys at all. */
  includeRoster: boolean;
  canClaim: boolean;
}

/** Identity + roster facts; class/level prefer the verified snapshot. */
function identityFields(
  row: RosterMemberRow,
  snap: RosterMemberSnapshot | null,
) {
  return {
    id: `${ROSTER_MEMBER_CHARACTER_ID_PREFIX}${row.memberId}`,
    userId: null,
    gameId: row.gameId,
    name: row.name,
    realm: null,
    class: snap?.class ?? row.class,
    level: snap?.level ?? row.level,
    region: row.region,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The `CharacterDto` keys a roster member never has a value for. */
function fixedFields() {
  return {
    roleOverride: null,
    isMain: false,
    externalId: null,
    renderUrl: null,
    faction: null,
    profileUrl: null,
    ruleset: null,
    gameVariant: WOW_FOREVER_VARIANT,
    hasManualProfessions: false,
    displayOrder: 0,
  } as const;
}

/** The read-only page's own keys (claim, D1 reason, roster-only facts). */
function memberPageFields(row: RosterMemberRow, opts: MapOptions) {
  const reason = noArmoryReason({
    memberBlizzardId: row.blizzardCharacterId,
    rosterLevel: row.level,
    snapshot: row.snapshot,
  });
  return {
    readOnly: true as const,
    rosterMemberId: row.memberId,
    hubId: row.guildId,
    canClaim: opts.canClaim,
    ...(reason === undefined ? {} : { noArmoryReason: reason }),
    ...(opts.includeRoster ? rosterOnlyFields(row) : {}),
  };
}

/** The roster member as a read-only character payload. */
export function toRosterMemberCharacter(
  row: RosterMemberRow,
  opts: MapOptions,
): Dto {
  const verified = isVerifiedSnapshot(row.blizzardCharacterId, row.snapshot);
  const snap = verified ? row.snapshot : null;
  const armory = armoryFields(snap);
  return {
    ...identityFields(row, snap),
    ...armory,
    ...fixedFields(),
    effectiveRole: armory.role,
    ...memberPageFields(row, opts),
  };
}
