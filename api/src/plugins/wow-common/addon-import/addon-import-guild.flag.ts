import type { Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AddonImportResultDto } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { REMOVAL_WINDOW_HOURS } from './addon-import-guild.guard';
import type { RosterFlag } from './addon-import-apply.types';
import { ROSTER_FLAG } from './addon-import.paste-run';

type Db = PostgresJsDatabase<typeof schema>;

export const ROSTER_FLAG_TITLE = 'Large guild roster change';

function flagMessage(guildName: string, flag: RosterFlag): string {
  const editor = flag.dropsEditor
    ? ' It also dropped a member with editor rights: if they left, remove their editor grant.'
    : '';
  return `An import for ${guildName} changed its roster a lot: with the last ${REMOVAL_WINDOW_HOURS}h of imports it removed ${flag.removed} and added ${flag.added} of the ${flag.live} members the guild had.${editor} The change was applied; if it looks wrong, import the roster yourself.`;
}

/**
 * ROK-2066 (was ROK-1794 AC4's hold) — tell every active admin and operator
 * about an APPLIED wholesale roster change, as an in-app `system` notice.
 * Runs on the outer db AFTER the import transaction committed; never throws
 * (the import already succeeded). The guild name is the STORED one, never
 * the pasted payload's (ROK-1724 echo rule).
 */
export async function flagRosterChange(
  db: Db,
  importerId: number | null,
  flag: RosterFlag,
  logger: Logger,
): Promise<void> {
  try {
    await insertFlags(db, importerId, flag);
  } catch (e: unknown) {
    logger.warn(
      `ROK-2066: roster-change flag failed for guild ${flag.guildId}: ${e instanceof Error ? e.message : 'Unknown error'}`,
    );
  }
}

/**
 * The ONE place both import routes (per-character and character-less) send
 * a committed APPLY result: flags the roster change its guild section
 * carries (`ROSTER_FLAG`, symbol-keyed off the wire). A preview carries none.
 */
export async function flagIfRosterChanged(
  db: Db,
  importerId: number,
  res: AddonImportResultDto & { [ROSTER_FLAG]?: RosterFlag },
  logger: Logger,
): Promise<void> {
  const flag = res[ROSTER_FLAG];
  if (flag) await flagRosterChange(db, importerId, flag, logger);
}

/**
 * Who can act on a flagged change — staff, whose own imports are never
 * flagged (`importerIsStaff`): admins AND operators, still active (review P3; same
 * recipients as the tiebreaker escalation).
 */
export const STAFF_ROLES = ['admin', 'operator'] as const;
const staffRecipients = and(
  inArray(schema.users.role, [...STAFF_ROLES]),
  isNull(schema.users.deactivatedAt),
);

async function insertFlags(
  db: Db,
  importerId: number | null,
  flag: RosterFlag,
): Promise<void> {
  const [guild] = await db
    .select({ name: schema.guilds.name })
    .from(schema.guilds)
    .where(eq(schema.guilds.id, flag.guildId));
  const admins = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(staffRecipients);
  if (!guild || admins.length === 0) return;
  const { guildId, removed, added, live, dropsEditor } = flag;
  await db.insert(schema.notifications).values(
    admins.map((a) => ({
      userId: a.id,
      type: 'system' as const,
      title: ROSTER_FLAG_TITLE,
      message: flagMessage(guild.name, flag),
      payload: { guildId, importerId, removed, added, live, dropsEditor },
    })),
  );
}
