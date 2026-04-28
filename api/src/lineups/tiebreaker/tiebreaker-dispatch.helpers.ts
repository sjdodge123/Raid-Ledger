/**
 * Tiebreaker-open dispatch helper (ROK-1117).
 *
 * Wraps the fire-and-forget DM/embed hook + the WebSocket broadcast so
 * `TiebreakerService.start()` stays a single line of dispatch and the
 * service file stays under the 300-line ESLint ceiling.
 */
import type { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { LineupNotificationService } from '../lineup-notification.service';
import type { LineupsGateway } from '../lineups.gateway';

type Db = PostgresJsDatabase<typeof schema>;

export interface TiebreakerOpenDispatch {
  lineupId: number;
  tiebreakerId: number;
  mode: 'bracket' | 'veto';
  roundDeadline: Date | null;
}

/**
 * Dispatch DM/embed notifications + WebSocket broadcast for a freshly
 * activated tiebreaker. Both side effects are awaited (with errors
 * swallowed) so consumers can rely on the fan-out being complete by
 * the time `start()` returns. The DM/embed pipeline itself still
 * dedups, so a slow consumer never blocks anything else.
 */
export async function dispatchTiebreakerOpen(
  notificationService: LineupNotificationService,
  lineupsGateway: LineupsGateway,
  logger: Logger,
  db: Db,
  payload: TiebreakerOpenDispatch,
): Promise<void> {
  try {
    await runTiebreakerOpenNotify(notificationService, db, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `notifyTiebreakerOpen failed for lineup ${payload.lineupId}: ${msg}`,
    );
  }
  try {
    lineupsGateway.emitTiebreakerOpen(
      payload.lineupId,
      payload.tiebreakerId,
      payload.mode,
      payload.roundDeadline ?? undefined,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `emitTiebreakerOpen failed for lineup ${payload.lineupId}: ${msg}`,
    );
  }
}

async function runTiebreakerOpenNotify(
  notificationService: LineupNotificationService,
  db: Db,
  payload: TiebreakerOpenDispatch,
): Promise<void> {
  // Re-use the lineup row helper from notify-hooks for visibility / title.
  const [lineupRow] = await db
    .select({
      id: schema.communityLineups.id,
      title: schema.communityLineups.title,
      visibility: schema.communityLineups.visibility,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, payload.lineupId))
    .limit(1);
  if (!lineupRow) return;
  const [tbRow] = await db
    .select({ tiedGameIds: schema.communityLineupTiebreakers.tiedGameIds })
    .from(schema.communityLineupTiebreakers)
    .where(eq(schema.communityLineupTiebreakers.id, payload.tiebreakerId))
    .limit(1);
  await notificationService.notifyTiebreakerOpen(
    {
      id: lineupRow.id,
      title: lineupRow.title,
      visibility: lineupRow.visibility,
    },
    {
      id: payload.tiebreakerId,
      mode: payload.mode,
      roundDeadline: payload.roundDeadline,
    },
    tbRow?.tiedGameIds,
  );
}
