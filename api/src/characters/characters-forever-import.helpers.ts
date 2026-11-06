/**
 * WoW: Forever Armory import rules (ROK-1722).
 *
 * Forever is realmless: an imported row has realm NULL, a ruleset, and
 * game_variant 'wow_forever' (which marks it Armory-linked so the auto-sync
 * picks it up). Identity is game + region + lower(name) across all players
 * (`idx_characters_ruleset_identity`), so an import over the player's own
 * manual row merges into it and one owned by another player is a 409.
 */
import { ConflictException } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  WowForeverRulesetSchema,
  type CharacterDto,
  type ImportWowCharacterDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { foreverLabel } from '../plugins/wow-common/wow-forever-identity.helpers';
import { mapCharacterToDto } from './characters-mapping.helpers';
import {
  buildSyncUpdateFieldsFromSync,
  type EnrichedProfile,
  type OptionalSyncFields,
} from './characters-sync.helpers';
import { defined } from '../common/defined.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = { log: (msg: string) => void };
type Profile = EnrichedProfile['profile'];
type CharacterRow = typeof schema.characters.$inferSelect;

/** Identity columns of an imported row. Forever adds ruleset + externalId. */
export interface ImportIdentityFields {
  name: string;
  realm: string | null;
  ruleset?: string;
  externalId?: string;
}

/** True when the import targets a realmless WoW: Forever character. */
export function isForeverImport(dto: ImportWowCharacterDto): boolean {
  return dto.gameVariant === 'wow_forever';
}

/**
 * Stored name: the profile's two-part casing when the body carries both
 * parts, else the player's own typed two-part name (FLAG B5 ruling).
 */
export function foreverImportName(profileName: string, typed: string): string {
  return profileName.trim().includes(' ') ? profileName.trim() : typed.trim();
}

/** Ruleset: the profile body's own ruleset when valid, else the player's pick (FLAG C3). */
export function resolveImportRuleset(
  profile: Profile,
  dto: ImportWowCharacterDto,
): string | null {
  const fromBody = WowForeverRulesetSchema.safeParse(
    'ruleset' in profile ? profile.ruleset : undefined,
  );
  return fromBody.success ? fromBody.data : dto.ruleset;
}

/** Blizzard character id from the profile body, when it carries one. */
export function profileExternalId(profile: Profile): string | null {
  const id = 'id' in profile ? profile.id : undefined;
  if (typeof id === 'number' || (typeof id === 'string' && id !== ''))
    return String(id);
  return null;
}

/** Name/realm (+ Forever ruleset/externalId) for an imported row. */
export function importIdentityFields(
  profile: Profile,
  dto: ImportWowCharacterDto,
): ImportIdentityFields {
  if (!isForeverImport(dto)) return { name: profile.name, realm: profile.realm };
  const ruleset = resolveImportRuleset(profile, dto);
  const externalId = profileExternalId(profile);
  return {
    name: foreverImportName(profile.name, dto.name),
    realm: null,
    ...(ruleset !== null ? { ruleset } : {}),
    ...(externalId !== null ? { externalId } : {}),
  };
}

/**
 * Find the Forever identity row (any owner) for game + region + name.
 * @throws ConflictException when another player owns it.
 * @returns the caller's own row to merge into, or undefined to insert.
 */
export async function claimForeverIdentity(
  tx: Db,
  args: { userId: number; gameId: number; name: string; region: string },
): Promise<CharacterRow | undefined> {
  const [existing] = await tx
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.gameId, args.gameId),
        eq(schema.characters.region, args.region),
        sql`lower(${schema.characters.name}) = lower(${args.name})`,
        isNotNull(schema.characters.ruleset),
      ),
    )
    .limit(1);
  if (existing && existing.userId !== args.userId)
    throw new ConflictException(
      `${foreverLabel(existing.name, args.region)} is already claimed by another player`,
    );
  return existing;
}

/**
 * Merge an import into the player's own Forever row: sync fields, ruleset
 * overwritten, game_variant + external_id set (the row becomes Armory-linked).
 */
export async function mergeForeverRow(
  tx: Db,
  existing: CharacterRow,
  profile: Profile,
  dto: ImportWowCharacterDto,
  sync: OptionalSyncFields,
  logger: Logger,
): Promise<CharacterDto> {
  const { ruleset, externalId } = importIdentityFields(profile, dto);
  const fields = buildSyncUpdateFieldsFromSync(profile, sync, {
    region: dto.region,
    gameVariant: dto.gameVariant,
  });
  const [merged] = await tx
    .update(schema.characters)
    .set({
      ...fields,
      ...(ruleset !== undefined ? { ruleset } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
    })
    .where(eq(schema.characters.id, existing.id))
    .returning();
  logger.log(
    `User ${existing.userId} merged Forever import into character ${existing.id} (${existing.name})`,
  );
  return mapCharacterToDto(defined(merged, 'merged Forever character row'));
}
