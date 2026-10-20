/**
 * Producer-side hub link lookups — ROK-1872 (ROK-1428 §2.8, §2.9).
 *
 * The embed builders take an already-resolved `hubLink`; these helpers load
 * the inputs a producer does not have in hand (the event's game + tagged
 * hub, a lineup's decided game) and resolve best-effort: any failure logs
 * and yields null, so a post never fails over its hub link.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { HubLink } from '../embeds/hub-link-button.helpers';
import {
  resolveGameHubLinkSafe,
  type HubLinkLogger,
} from './hub-link.resolver';

type Db = PostgresJsDatabase<typeof schema>;

function warnFailure(logger: HubLinkLogger, what: string, err: unknown): null {
  const reason = err instanceof Error ? err.message : String(err);
  logger.warn(`Hub link lookup failed for ${what}: ${reason}`);
  return null;
}

/**
 * `{ hubLink }` when a link resolved, else `{}` — the key is omitted so a
 * context without a hub stays byte-identical to the pre-ROK-1872 shape.
 */
export function hubLinkPart(link: HubLink | null): { hubLink?: HubLink } {
  return link ? { hubLink: link } : {};
}

/**
 * Resolve an event card's hub link from the event row (`game_id` +
 * `guild_id` as the tagged hub). Never throws.
 */
export async function resolveEventHubLink(
  db: Db,
  eventId: number,
  clientUrl: string | null | undefined,
  logger: HubLinkLogger,
): Promise<HubLink | null> {
  if (!clientUrl) return null;
  try {
    const [row] = await db
      .select({ gameId: schema.events.gameId, guildId: schema.events.guildId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row) return null;
    const input = { gameId: row.gameId, taggedGuildId: row.guildId, clientUrl };
    return await resolveGameHubLinkSafe(db, input, logger);
  } catch (err: unknown) {
    return warnFailure(logger, `event ${eventId}`, err);
  }
}

/**
 * Resolve the hub link for a lineup's `decided_game_id` (decided embed).
 * Never throws.
 */
export async function resolveLineupDecidedHubLink(
  db: Db,
  lineupId: number,
  clientUrl: string | null | undefined,
  logger: HubLinkLogger,
): Promise<HubLink | null> {
  if (!clientUrl) return null;
  try {
    const [row] = await db
      .select({ decidedGameId: schema.communityLineups.decidedGameId })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
    const gameId = row?.decidedGameId ?? null;
    if (gameId === null) return null;
    return await resolveGameHubLinkSafe(db, { gameId, clientUrl }, logger);
  } catch (err: unknown) {
    return warnFailure(logger, `lineup ${lineupId}`, err);
  }
}
