/**
 * Public-share toggle helper (ROK-1067).
 * Extracted from LineupsService to keep that file lean.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import {
  buildDetailResponse,
  type ResolveChannelName,
} from './lineups-response.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Flip a lineup's `public_share_enabled` boolean. Operator-only.
 *
 * Refuses to enable share on a private lineup (defends the invariant the
 * create-time refine already enforces). Disabling preserves the slug, so
 * re-enabling restores access via the same URL.
 *
 * Logs every flip with `before` and `after` boolean state — auditors need
 * to see "was true, now false" without re-reading the row.
 */
export async function togglePublicShare(
  db: Db,
  activityLog: ActivityLogService,
  resolveChannelName: ResolveChannelName,
  lineupId: number,
  enabled: boolean,
  actorId: number,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await db
    .select({
      id: schema.communityLineups.id,
      visibility: schema.communityLineups.visibility,
      publicShareEnabled: schema.communityLineups.publicShareEnabled,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) throw new NotFoundException('Lineup not found');

  if (enabled && lineup.visibility === 'private') {
    throw new BadRequestException(
      'Private lineups cannot have public share enabled',
    );
  }

  if (lineup.publicShareEnabled !== enabled) {
    await db
      .update(schema.communityLineups)
      .set({ publicShareEnabled: enabled, updatedAt: new Date() })
      .where(eq(schema.communityLineups.id, lineupId));
    await activityLog.log(
      'lineup',
      lineupId,
      'lineup_public_share_toggled',
      actorId,
      { before: lineup.publicShareEnabled, after: enabled },
    );
  }

  return buildDetailResponse(db, lineupId, actorId, resolveChannelName);
}
