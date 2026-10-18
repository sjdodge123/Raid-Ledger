import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';

/**
 * ROK-1794 (Codex P1): a roster row the importer introduced confers no
 * import rights on them until another user's import carries it. Specs whose
 * single user re-imports its own guild stamp that corroboration directly.
 */
export async function corroborateRoster(
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  await db.update(schema.guildMembers).set({ corroboratedAt: new Date() });
}
