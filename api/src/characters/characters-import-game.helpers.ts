/**
 * Game lookup for an external character import (split out of
 * characters-import.helpers.ts for the file-size limit, ROK-1722).
 */
import { NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';
import { variantToNamespacePrefix } from '../plugins/wow-common/blizzard.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** Resolve game by slug candidates + namespace prefix from adapter. */
export async function resolveGameByVariant(
  db: Db,
  adapter: CharacterSyncAdapter,
  gameVariant: string,
): Promise<typeof schema.games.$inferSelect> {
  const slugCandidates = adapter.resolveGameSlugs(gameVariant);
  const nsPrefix = variantToNamespacePrefix(gameVariant);
  const nsFilter =
    nsPrefix === null
      ? isNull(schema.games.apiNamespacePrefix)
      : eq(schema.games.apiNamespacePrefix, nsPrefix);
  const [game] = await db
    .select()
    .from(schema.games)
    .where(and(inArray(schema.games.slug, slugCandidates), nsFilter))
    .limit(1);
  if (!game) throw new NotFoundException('Game not found in the games catalog');
  return game;
}
