import { Logger } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { inLatestSnapshot } from './guild-link.predicates';

/**
 * ROK-2115 Ruling 3 — a live roster row whose LedgerLink GUID holder and
 * Blizzard-id holder are DIFFERENT characters. `characterLink()` already
 * resolves it (GUID wins); this only surfaces it for staff/ops. Ids only —
 * never character or user names.
 */
export interface LinkDisagreement {
  guildId: number;
  memberId: number;
  guidCharacterId: string;
  blizzardCharacterId: string;
}

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers } = schema;
const byGuid = alias(schema.characters, 'disagree_guid_char');
const byBlizzard = alias(schema.characters, 'disagree_blizzard_char');
const logger = new Logger('GuildLinkDisagreement');

/** The row's GUID holder — arm A's rule. */
function guidHolderJoin() {
  return and(
    eq(byGuid.addonGuid, guildMembers.guid),
    eq(byGuid.gameId, guilds.gameId),
    sql`(${byGuid.region} is null or lower(${byGuid.region}) = lower(${guilds.region}))`,
  );
}

/** A DIFFERENT character holding the row's Blizzard id — arm B's match rule. */
function blizzardHolderJoin() {
  return and(
    sql`${byBlizzard.externalId} = ${guildMembers.blizzardCharacterId}::text`,
    eq(byBlizzard.gameId, guilds.gameId),
    sql`lower(${byBlizzard.region}) = lower(${guilds.region})`,
    ne(byBlizzard.id, byGuid.id),
  );
}

/** The guild's live rows whose two link arms name different characters. */
export async function findLinkDisagreements(
  db: Db,
  guildId: number,
): Promise<LinkDisagreement[]> {
  return db
    .select({
      guildId: guildMembers.guildId,
      memberId: guildMembers.id,
      guidCharacterId: byGuid.id,
      blizzardCharacterId: byBlizzard.id,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(byGuid, guidHolderJoin())
    .innerJoin(byBlizzard, blizzardHolderJoin())
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()));
}

/** One warn line per disagreeing row (ids only). */
export function warnLinkDisagreements(
  rows: readonly LinkDisagreement[],
  log: Pick<Logger, 'warn'> = logger,
): void {
  for (const row of rows) log.warn({ msg: 'roster link disagreement', ...row });
}

/**
 * Best effort, once per roster read: find and log the guild's disagreements.
 * Never throws — a failed lookup must not break the page.
 */
export async function logLinkDisagreements(
  db: Db,
  guildId: number,
): Promise<void> {
  try {
    warnLinkDisagreements(await findLinkDisagreements(db, guildId));
  } catch (err) {
    logger.debug(`link disagreement check failed: ${String(err)}`);
  }
}
