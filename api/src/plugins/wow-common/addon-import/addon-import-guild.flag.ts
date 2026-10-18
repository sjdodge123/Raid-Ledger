import type { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { RosterHeldError } from './addon-import-guild.guard';

type Db = PostgresJsDatabase<typeof schema>;

export const ROSTER_HELD_TITLE = 'Guild roster import held';

function heldMessage(guildName: string, err: RosterHeldError): string {
  const editor = err.dropsEditor
    ? ', including a member with editor rights'
    : '';
  return `An import for ${guildName} would have removed ${err.removed} of ${err.live} current members${editor}. The roster was kept; import it yourself if the change is real.`;
}

/**
 * ROK-1794 AC4 — flag a held guild snapshot to every admin as an in-app
 * `system` notice. Runs on the outer db AFTER the import transaction rolled
 * back; never throws (the importer still gets the 422). The guild name is
 * the STORED one, never the pasted payload's (ROK-1724 echo rule).
 */
export async function flagHeldRoster(
  db: Db,
  importerId: number,
  err: RosterHeldError,
  logger: Logger,
): Promise<void> {
  try {
    await insertFlags(db, importerId, err);
  } catch (e: unknown) {
    logger.warn(
      `ROK-1794: held-roster flag failed for guild ${err.guildId}: ${e instanceof Error ? e.message : 'Unknown error'}`,
    );
  }
}

async function insertFlags(
  db: Db,
  importerId: number,
  err: RosterHeldError,
): Promise<void> {
  const [guild] = await db
    .select({ name: schema.guilds.name })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, err.guildId));
  const admins = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.role, 'admin'));
  if (!guild || admins.length === 0) return;
  const { guildId, removed, live, dropsEditor } = err;
  await db.insert(schema.notifications).values(
    admins.map((a) => ({
      userId: a.id,
      type: 'system' as const,
      title: ROSTER_HELD_TITLE,
      message: heldMessage(guild.name, err),
      payload: { guildId, importerId, removed, live, dropsEditor },
    })),
  );
}
