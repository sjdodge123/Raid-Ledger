/**
 * ROK-1374 — the three notification edges of the tie lifecycle, wired by the
 * Lead once the lanes merged (the lanes exposed helpers; they did not wire
 * each other).
 *
 * Every function here is BEST EFFORT (E5): a failed DM or Discord edit must
 * never fail the transition or the job that reached the edge. The columns on
 * the lineup row are the source of truth; Discord and DMs describe them.
 */
import type { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { LineupInfo } from '../lineup-notification.service';
import type { OrchestrationDeps } from '../lineup-notification-public-dispatch.helpers';
import {
  notifyTieDecided,
  notifyTieDetected,
  notifyTieExpired,
} from '../lineup-notification-tie.helpers';
import { countOwnersPerGame } from '../lineups-enrichment.helpers';
import { loadExpectedVoters } from '../quorum/quorum-voters.helpers';
import type { TieResult } from './tiebreaker-detect.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** D4: fires on the null→set edge only — the caller checks `hold.opened`. */
export async function announceTieDetected(
  deps: OrchestrationDeps,
  logger: Logger,
  lineup: LineupRow,
  tie: TieResult,
): Promise<void> {
  try {
    await notifyTieDetected(deps, info(lineup), tie);
  } catch (err) {
    logger.warn(
      `Tie-detected notification for lineup ${lineup.id} failed: ${message(err)}`,
    );
  }
}

/**
 * The pick advanced the lineup to `decided`: edit the tie message to DECIDED
 * and DM the roster, naming the picker and the roster-scoped ownership.
 */
export async function announceTieDecided(
  deps: OrchestrationDeps,
  db: Db,
  logger: Logger,
  lineup: LineupRow,
): Promise<void> {
  try {
    const facts = await decidedFacts(db, lineup);
    if (!facts) return;
    await notifyTieDecided(
      deps,
      info(lineup),
      facts.game,
      facts.pickedBy,
      facts.owned,
      lineup.tiePickBy,
    );
  } catch (err) {
    logger.warn(
      `Tie-decided notification for lineup ${lineup.id} failed: ${message(err)}`,
    );
  }
}

/** D13: the sweep archived the lineup undecided — say so, once. */
export async function announceTieExpired(
  deps: OrchestrationDeps,
  logger: Logger,
  lineup: LineupRow,
): Promise<void> {
  try {
    await notifyTieExpired(deps, info(lineup));
  } catch (err) {
    logger.warn(
      `Tie-expired notification for lineup ${lineup.id} failed: ${message(err)}`,
    );
  }
}

/** The picked game, who picked it, and how many of the ROSTER own it. */
async function decidedFacts(
  db: Db,
  lineup: LineupRow,
): Promise<{
  game: { id: number; name: string };
  pickedBy: string;
  owned: { count: number; rosterSize: number };
} | null> {
  if (lineup.tiePickGameId === null) return null;
  const [game] = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, lineup.tiePickGameId))
    .limit(1);
  if (!game) return null;
  const pickedBy = await pickerName(db, lineup.tiePickBy);
  const roster = await loadExpectedVoters(db, lineup);
  const owners = await countOwnersPerGame(db, [game.id], roster);
  return {
    game,
    pickedBy,
    owned: { count: owners.get(game.id) ?? 0, rosterSize: roster.length },
  };
}

async function pickerName(db: Db, userId: number | null): Promise<string> {
  if (userId === null) return 'the lineup creator';
  const [user] = await db
    .select({
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user?.displayName ?? user?.username ?? 'the lineup creator';
}

function info(lineup: LineupRow): LineupInfo {
  return {
    id: lineup.id,
    title: lineup.title,
    visibility: lineup.visibility,
    channelOverrideId: lineup.channelOverrideId,
    phaseDeadline: lineup.phaseDeadline,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
