/**
 * ROK-2133 (D5, Q10): the Armory item level / spec / role on the guild
 * members list and the roster-claim pick list — the linked character's
 * Armory columns when it is Armory-synced (`wow_forever`), else the member's
 * verified `guild_member_armory` snapshot. A manual character's own values
 * lose to the snapshot (operator ruling 2026-11-08: rely on the official
 * Blizzard API).
 * Optional DTO keys: omitted (never null) when there is no value.
 */
import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  CharacterRoleSchema,
  type GuildMemberRow,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { WOW_FOREVER_VARIANT } from '../forever-armory-switch';

const { characters: c, guildMembers: m, guildMemberArmory: a } = schema;

/** The raw Armory columns a roster / candidate query selects. */
export interface ArmoryFieldsRow {
  armoryItemLevel?: number | null;
  armorySpec?: string | null;
  armoryRole?: string | null;
}

/** The optional DTO keys, shared by `GuildMemberRow` and the pick list. */
export type ArmoryDtoFields = Pick<
  GuildMemberRow,
  'itemLevel' | 'spec' | 'role'
>;

/**
 * LEFT JOIN condition for the member's snapshot, only while it is still
 * verified against the member's current Blizzard id.
 */
export function memberSnapshotJoin(): SQL | undefined {
  return and(
    eq(a.guildMemberId, m.id),
    eq(a.blizzardCharacterId, m.blizzardCharacterId),
  );
}

/** Snapshot-only columns (unclaimed rows have no character). */
export const snapshotArmoryColumns = {
  armoryItemLevel: a.itemLevel,
  armorySpec: a.spec,
  armoryRole: a.role,
};

/** The character's value only when Armory-synced, else the snapshot's. */
function armoryFirst<T>(charCol: AnyColumn, snapCol: AnyColumn): SQL<T | null> {
  return sql<T | null>`coalesce(case when ${c.gameVariant} = ${WOW_FOREVER_VARIANT} then ${charCol} end, ${snapCol})`;
}

/**
 * An Armory-synced character's columns first, the member snapshot as the
 * fallback; a manual character's user-set values never beat the snapshot.
 */
export const memberArmoryColumns = {
  armoryItemLevel: armoryFirst<number>(c.itemLevel, a.itemLevel),
  armorySpec: armoryFirst<string>(c.spec, a.spec),
  armoryRole: armoryFirst<string>(c.role, a.role),
};

/** The DTO keys present on `row`; each invalid or missing value is omitted. */
export function armoryDtoFields(row: ArmoryFieldsRow): ArmoryDtoFields {
  const ilvl = row.armoryItemLevel;
  const spec = row.armorySpec;
  const role = CharacterRoleSchema.safeParse(row.armoryRole);
  return {
    ...(typeof ilvl === 'number' && Number.isInteger(ilvl) && ilvl >= 0
      ? { itemLevel: ilvl }
      : {}),
    ...(spec ? { spec: spec.slice(0, 50) } : {}),
    ...(role.success ? { role: role.data } : {}),
  };
}
