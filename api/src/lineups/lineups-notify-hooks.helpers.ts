/**
 * Fire-and-forget notification hook wrappers for lifecycle events (ROK-932).
 * These are thin wrappers that catch errors and log them so that
 * notifications never block the main flow.
 */
import { eq } from 'drizzle-orm';
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { LineupNotificationService } from './lineup-notification.service';
import type { LineupInfo, MatchInfo } from './lineup-notification.service';
import {
  checkNominationMilestone,
  getEntryDetails,
} from './lineups-milestone.helpers';
import { findNominatedGames, findGameName } from './lineups-query.helpers';
import type { CallerIdentity } from './lineups.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Log and swallow notification errors. */
function logError(logger: Logger, context: string): (err: unknown) => void {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Notification failed (${context}): ${msg}`);
  };
}

/** Fire lineup-created channel embed notification. */
export function fireLineupCreated(
  svc: LineupNotificationService,
  logger: Logger,
  lineup: LineupInfo,
): void {
  svc.notifyLineupCreated(lineup).catch(logError(logger, 'lineup-created'));
}

/**
 * Fire an in-place embed refresh after metadata edit (ROK-1063).
 * No-op when the lineup has no stored Discord message reference.
 */
export function fireLineupMetadataRefresh(
  svc: LineupNotificationService,
  logger: Logger,
  lineup: LineupInfo,
): void {
  svc
    .refreshCreatedEmbed(lineup)
    .catch(logError(logger, 'lineup-metadata-refresh'));
}

/** Check and fire nomination milestone notification. */
export function fireNominationMilestone(
  svc: LineupNotificationService,
  logger: Logger,
  db: Db,
  lineupId: number,
): void {
  checkNominationMilestone(db, lineupId)
    .then(async (result) => {
      if (!result) return;
      const entries = await getEntryDetails(db, lineupId);
      await svc.notifyNominationMilestone(lineupId, result.threshold, entries);
    })
    .catch(logError(logger, 'nomination-milestone'));
}

/** Fire voting-open notifications (channel embed + DMs). */
export function fireVotingOpen(
  svc: LineupNotificationService,
  logger: Logger,
  db: Db,
  lineupId: number,
  phaseDeadline: Date | null,
): void {
  findNominatedGames(db, lineupId)
    .then((games) =>
      svc.notifyVotingOpen(
        { id: lineupId, votingDeadline: phaseDeadline ?? undefined },
        games,
      ),
    )
    .catch(logError(logger, 'voting-open'));
}

/** Fire decided-phase notifications (channel embed). */
export function fireDecidedNotifications(
  svc: LineupNotificationService,
  logger: Logger,
  db: Db,
  lineupId: number,
): void {
  loadMatchesForNotification(db, lineupId)
    .then((matches) => {
      if (matches.length > 0) {
        return svc.notifyMatchesFound(lineupId, matches);
      }
    })
    .catch(logError(logger, 'decided'));
}

/** Fire nomination-removed DM (operator removals only). */
export function fireNominationRemoved(
  svc: LineupNotificationService,
  logger: Logger,
  db: Db,
  lineupId: number,
  gameId: number,
  entry: typeof schema.communityLineupEntries.$inferSelect,
  caller: CallerIdentity,
): void {
  const isOperator = caller.role === 'operator' || caller.role === 'admin';
  if (!isOperator || entry.nominatedBy === caller.id) return;

  findGameName(db, gameId)
    .then(([game]) => {
      if (!game) return;
      return svc.notifyNominationRemoved(
        lineupId,
        gameId,
        game.name,
        entry.nominatedBy,
        'Operator',
      );
    })
    .catch(logError(logger, 'nomination-removed'));
}

/** Fire scheduling-open channel embed + DMs for a promoted match. */
export function fireSchedulingOpen(
  svc: LineupNotificationService,
  logger: Logger,
  db: Db,
  matchId: number,
): void {
  loadSingleMatch(db, matchId)
    .then((match) => {
      if (match) return svc.notifySchedulingOpen(match);
    })
    .catch(logError(logger, 'scheduling-open'));
}

/** Fire event-created channel embed + DMs. */
export function fireEventCreated(
  svc: LineupNotificationService,
  logger: Logger,
  db: Db,
  matchId: number,
  eventDate: Date,
  eventId?: number,
): void {
  loadSingleMatch(db, matchId)
    .then((match) => {
      if (match) return svc.notifyEventCreated(match, eventDate, eventId);
    })
    .catch(logError(logger, 'event-created'));
}

// ─── Private: match loading queries ────────────────────────

/** Load all matches for a lineup in notification format. */
async function loadMatchesForNotification(
  db: Db,
  lineupId: number,
): Promise<MatchInfo[]> {
  const rows = await db
    .select({
      id: schema.communityLineupMatches.id,
      lineupId: schema.communityLineupMatches.lineupId,
      gameId: schema.communityLineupMatches.gameId,
      gameName: schema.games.name,
      status: schema.communityLineupMatches.status,
      thresholdMet: schema.communityLineupMatches.thresholdMet,
      voteCount: schema.communityLineupMatches.voteCount,
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.games,
      eq(schema.communityLineupMatches.gameId, schema.games.id),
    )
    .where(eq(schema.communityLineupMatches.lineupId, lineupId));
  return rows;
}

/** Load a single match for notification format. */
async function loadSingleMatch(
  db: Db,
  matchId: number,
): Promise<MatchInfo | null> {
  const [row] = await db
    .select({
      id: schema.communityLineupMatches.id,
      lineupId: schema.communityLineupMatches.lineupId,
      gameId: schema.communityLineupMatches.gameId,
      gameName: schema.games.name,
      status: schema.communityLineupMatches.status,
      thresholdMet: schema.communityLineupMatches.thresholdMet,
      voteCount: schema.communityLineupMatches.voteCount,
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.games,
      eq(schema.communityLineupMatches.gameId, schema.games.id),
    )
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  return row ?? null;
}
