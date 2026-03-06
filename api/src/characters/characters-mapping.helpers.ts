/**
 * Character DTO mapping and main-swap helpers.
 * Extracted from characters.service.ts for file size compliance (ROK-711).
 */
import { eq, and, count } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/** Map a character database row to a CharacterDto. */
export function mapCharacterToDto(
  row: typeof schema.characters.$inferSelect,
): CharacterDto {
  const roleOverride = row.roleOverride as CharacterDto['role'];
  const role = row.role as CharacterDto['role'];
  return {
    id: row.id,
    userId: row.userId,
    gameId: row.gameId,
    name: row.name,
    realm: row.realm,
    class: row.class,
    spec: row.spec,
    role,
    roleOverride,
    effectiveRole: roleOverride ?? role,
    isMain: row.isMain,
    itemLevel: row.itemLevel,
    externalId: row.externalId,
    avatarUrl: row.avatarUrl,
    renderUrl: row.renderUrl ?? null,
    level: row.level,
    race: row.race,
    faction: row.faction as CharacterDto['faction'],
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    profileUrl: row.profileUrl,
    region: row.region ?? null,
    gameVariant: row.gameVariant ?? null,
    equipment: (row.equipment as CharacterDto['equipment']) ?? null,
    talents: row.talents ?? null,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Count existing characters and determine if new character should be main. */
export async function resolveMainStatus(
  tx: PostgresJsDatabase<typeof schema>,
  userId: number,
  gameId: number,
  requestedIsMain?: boolean,
): Promise<{ shouldBeMain: boolean; charCount: number }> {
  const [{ charCount }] = await tx
    .select({ charCount: count() })
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.userId, userId),
        eq(schema.characters.gameId, gameId),
      ),
    );
  const shouldBeMain = requestedIsMain === true || Number(charCount) === 0;
  return { shouldBeMain, charCount: Number(charCount) };
}

/** Demote existing main character for the same game (swap behavior). */
export async function demoteExistingMain(
  tx: PostgresJsDatabase<typeof schema>,
  userId: number,
  gameId: number,
): Promise<void> {
  await tx
    .update(schema.characters)
    .set({ isMain: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.characters.userId, userId),
        eq(schema.characters.gameId, gameId),
        eq(schema.characters.isMain, true),
      ),
    );
}
