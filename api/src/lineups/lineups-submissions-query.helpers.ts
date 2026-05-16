/**
 * Viewer submission lookup (ROK-1296, U4 SubmitBar).
 *
 * Tiny helper that hydrates the viewer's per-phase submission timestamps
 * for inclusion in `LineupDetailResponseDto.viewerSubmissions`. Returns
 * both nulls when the viewer is unauthenticated or has no row yet.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ViewerSubmissionsDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const EMPTY: ViewerSubmissionsDto = {
  nominationsSubmittedAt: null,
  votesSubmittedAt: null,
};

/**
 * Resolve the viewer's submission timestamps for a lineup.
 * Returns `{ null, null }` when `userId` is undefined or no row exists.
 */
export async function findViewerSubmissions(
  db: Db,
  lineupId: number,
  userId: number | undefined,
): Promise<ViewerSubmissionsDto> {
  if (userId === undefined) return EMPTY;
  const [row] = await db
    .select({
      nominationsSubmittedAt:
        schema.communityLineupUserSubmissions.nominationsSubmittedAt,
      votesSubmittedAt:
        schema.communityLineupUserSubmissions.votesSubmittedAt,
    })
    .from(schema.communityLineupUserSubmissions)
    .where(
      and(
        eq(schema.communityLineupUserSubmissions.lineupId, lineupId),
        eq(schema.communityLineupUserSubmissions.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return EMPTY;
  return {
    nominationsSubmittedAt: row.nominationsSubmittedAt?.toISOString() ?? null,
    votesSubmittedAt: row.votesSubmittedAt?.toISOString() ?? null,
  };
}
