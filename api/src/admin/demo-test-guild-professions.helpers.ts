/**
 * ROK-2107 — the seed-guild `armoryProfessions` fixture: an optional
 * professions blob written to the linked characters' `armory_professions`
 * (the column only the Blizzard sync writes), so a fleet UI plan can
 * deep-link a character whose professions panel shows the "Armory" pill.
 * Same DEMO_MODE + admin guards as the rest of seed-guild.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { BadRequestException } from '@nestjs/common';
import {
  CharacterProfessionsSchema,
  type CharacterProfessionsDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** `{ armoryProfessions }` when the body carries a valid blob, `{}` when absent; 400 otherwise. */
export function parseArmoryProfessionsFlag(raw: {
  armoryProfessions?: unknown;
}): { armoryProfessions?: CharacterProfessionsDto } {
  if (raw.armoryProfessions === undefined) return {};
  const parsed = CharacterProfessionsSchema.safeParse(raw.armoryProfessions);
  if (!parsed.success) {
    throw new BadRequestException(
      'armoryProfessions must be a CharacterProfessions object',
    );
  }
  return { armoryProfessions: parsed.data };
}

/**
 * Write the blob to every seeded character's `armory_professions`. An UPDATE
 * (not part of the insert) so a re-seed of an existing guild applies it too.
 */
export async function applyArmoryProfessions(
  db: Db,
  users: Readonly<Record<string, { characterId: string | null }>>,
  professions: CharacterProfessionsDto | undefined,
): Promise<void> {
  const ids = Object.values(users)
    .map((u) => u.characterId)
    .filter((id): id is string => id !== null);
  if (!professions || ids.length === 0) return;
  await db
    .update(schema.characters)
    // Stamp the sync marker too, as a real Armory sync would — readers only
    // trust armory_professions on a synced row (ROK-2107 review r2 MINOR 1).
    .set({
      armoryProfessions: professions,
      lastSyncedAt: new Date(professions.syncedAt),
    })
    .where(inArray(schema.characters.id, ids));
}
