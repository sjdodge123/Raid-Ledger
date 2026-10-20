import type { Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import {
  REMOVAL_WINDOW_HOURS,
  RosterHeldError,
} from './addon-import-guild.guard';

type Db = PostgresJsDatabase<typeof schema>;

export const ROSTER_HELD_TITLE = 'Guild roster import held';

function heldMessage(guildName: string, err: RosterHeldError): string {
  const editor = err.dropsEditor
    ? ' It also drops a member with editor rights: if they left, remove their editor grant or import the roster yourself.'
    : '';
  return `An import for ${guildName} was held: with the last ${REMOVAL_WINDOW_HOURS}h of imports it would remove ${err.removed} and add ${err.added} of the ${err.live} members the guild had.${editor} The roster was kept; import it yourself if the change is real.`;
}

/**
 * ROK-1794 AC4 — flag a held guild snapshot to every active admin and
 * operator as an in-app `system` notice. Runs on the outer db AFTER the import transaction rolled
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

/**
 * ROK-1794 Codex P2 — the ONE place both import routes (per-character and
 * character-less) send a failed import: flags it when it was a held roster
 * on APPLY. A preview (`dryRun`) runs the same guard and throws the same
 * error, but changed nothing — it flags no one (review P3).
 */
export async function flagIfRosterHeld(
  db: Db,
  importerId: number,
  err: unknown,
  logger: Logger,
  dryRun: boolean,
): Promise<void> {
  if (!dryRun && err instanceof RosterHeldError) {
    await flagHeldRoster(db, importerId, err, logger);
  }
}

/**
 * Who can act on a hold — staff, the roles that may import past it
 * (`importerIsStaff`): admins AND operators, still active (review P3; same
 * recipients as the tiebreaker escalation).
 */
export const STAFF_ROLES = ['admin', 'operator'] as const;
const staffRecipients = and(
  inArray(schema.users.role, [...STAFF_ROLES]),
  isNull(schema.users.deactivatedAt),
);

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
    .where(staffRecipients);
  if (!guild || admins.length === 0) return;
  const { guildId, removed, added, live, dropsEditor } = err;
  await db.insert(schema.notifications).values(
    admins.map((a) => ({
      userId: a.id,
      type: 'system' as const,
      title: ROSTER_HELD_TITLE,
      message: heldMessage(guild.name, err),
      payload: { guildId, importerId, removed, added, live, dropsEditor },
    })),
  );
}
