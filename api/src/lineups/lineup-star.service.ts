/**
 * ROK-1474 (D12/D13) — `POST /lineups/:id/star`.
 *
 * Its own service rather than a method on `LineupsService`, which counts 295
 * of its 300 permitted lines. The precedent is `TieReadinessController`
 * (ROK-1374), documented at `tie-readiness.controller.ts:1-11`.
 *
 * A star is a vote, so it passes every gate a vote passes — same status
 * check, same `assertVoteOpen` hold guard, same participation check. Skipping
 * any of them would let a star land during an open tie hold and dissolve the
 * tie underneath the readiness card, which is the exact operator-reported bug
 * ROK-1374 shipped to fix.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { assertVoteOpen } from './lineups-actions.helpers';
import { assertUserCanParticipate } from './lineups-eligibility.helpers';
import { findLineupById } from './lineups-query.helpers';
import { setStar } from './lineups-voting.helpers';
import { buildDetailResponse } from './lineups-response.helpers';

@Injectable()
export class LineupStarService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly activityLog: ActivityLogService,
    private readonly botClient: DiscordBotClientService,
  ) {}

  /** Resolve a Discord channel name from its ID via bot cache (ROK-1064). */
  private resolveChannelName = (channelId: string): string | null =>
    this.botClient.getGuild()?.channels?.cache?.get(channelId)?.name ?? null;

  /**
   * Set or clear the caller's single top pick.
   *
   * @param gameId - the game to star, or null to clear the star.
   * @returns the refreshed lineup detail, exactly as a vote does.
   */
  async setStar(
    lineupId: number,
    gameId: number | null,
    userId: number,
    callerRole?: string,
  ): Promise<LineupDetailResponseDto> {
    const lineup = await this.loadVotableLineup(lineupId, userId, callerRole);
    const action = await setStar(
      this.db,
      lineupId,
      userId,
      gameId,
      lineup.maxVotesPerPlayer ?? 3,
    );
    // ROK-1474 (D14): the outcome is now partly determined by stars, so an
    // unlogged star is an unexplainable decision.
    await this.activityLog.log(
      'lineup',
      lineupId,
      action === 'set' ? 'vote_starred' : 'vote_star_cleared',
      userId,
      { gameId },
    );
    return buildDetailResponse(
      this.db,
      lineupId,
      userId,
      this.resolveChannelName,
    );
  }

  /** The same four gates `runToggleVote` applies, in the same order. */
  private async loadVotableLineup(
    lineupId: number,
    userId: number,
    callerRole?: string,
  ) {
    const [lineup] = await findLineupById(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.status !== 'voting') {
      throw new BadRequestException('Voting is only allowed in voting status');
    }
    assertVoteOpen(lineup);
    await assertUserCanParticipate(this.db, lineup, {
      id: userId,
      role: callerRole,
    });
    return lineup;
  }
}
