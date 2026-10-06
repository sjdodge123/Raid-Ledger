/**
 * Viewer-aware reads behind `GET /games/:id/activity` and
 * `GET /games/:id/now-playing` (ROK-443, ROK-1734).
 *
 * Signed-in, non-deactivated members get the service payload unchanged;
 * anonymous and deactivated viewers get the public identity shape (no
 * `discordId`, server-built avatar URL). Lives outside `igdb.controller.ts`
 * to keep that file under the 300-line cap.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ActivityPeriodSchema } from '@raid-ledger/contract';
import type {
  GameActivityResponseDto,
  GameNowPlayingResponseDto,
  PublicGameActivityResponseDto,
  PublicGameNowPlayingResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { IgdbService } from './igdb.service';
import type { OptionalViewer } from './igdb-personalization.helpers';
import { isMemberViewer } from '../events/roster-public-projection.helpers';
import {
  projectGameActivity,
  projectNowPlaying,
} from '../common/public-identity-projection.helpers';

export type GameActivityForViewerDto =
  GameActivityResponseDto | PublicGameActivityResponseDto;
export type NowPlayingForViewerDto =
  GameNowPlayingResponseDto | PublicGameNowPlayingResponseDto;

type ActivityDeps = Pick<IgdbService, 'database' | 'getGameActivity'>;
type NowPlayingDeps = Pick<IgdbService, 'getGameNowPlaying'>;

async function assertGameExists(
  db: IgdbService['database'],
  id: number,
): Promise<void> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.id, id))
    .limit(1);
  if (rows.length === 0) throw new NotFoundException('Game not found');
}

/** Validate the period (400), 404 an unknown game, then project per viewer. */
export async function gameActivityForViewer(
  igdb: ActivityDeps,
  id: number,
  periodParam: string | undefined,
  req: OptionalViewer | undefined,
): Promise<GameActivityForViewerDto> {
  const period = ActivityPeriodSchema.safeParse(periodParam ?? 'week');
  if (!period.success)
    throw new BadRequestException(
      'Invalid period. Must be week, month, or all.',
    );
  await assertGameExists(igdb.database, id);
  const payload = await igdb.getGameActivity(id, period.data);
  return projectGameActivity(payload, isMemberViewer(req?.user));
}

/** Users currently playing the game, projected per viewer. */
export async function nowPlayingForViewer(
  igdb: NowPlayingDeps,
  id: number,
  req: OptionalViewer | undefined,
): Promise<NowPlayingForViewerDto> {
  const payload = await igdb.getGameNowPlaying(id);
  return projectNowPlaying(payload, isMemberViewer(req?.user));
}
