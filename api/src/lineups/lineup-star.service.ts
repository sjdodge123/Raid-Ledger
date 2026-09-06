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
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { assertVoteOpen } from './lineups-actions.helpers';
import { assertUserCanParticipate } from './lineups-eligibility.helpers';
import { findLineupById } from './lineups-query.helpers';
import { isGameNominated, setStar } from './lineups-voting.helpers';
import { buildDetailResponse } from './lineups-response.helpers';

@Injectable()
export class LineupStarService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
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
    const lineup = await this.loadVotableLineup(
      lineupId,
      userId,
      gameId,
      callerRole,
    );
    await setStar(
      this.db,
      lineupId,
      userId,
      gameId,
      lineup.maxVotesPerPlayer ?? 3,
    );
    // ROK-1474 (D14 REVERSED by the operator ruling of 2026-09-06): a star is
    // NOT logged to the activity timeline. `GET /lineups/:id/activity` is
    // any-authenticated and returns `actor.{id,displayName}` plus the raw
    // metadata for every row, so a `vote_starred` entry told every other voter
    // whose pick was whose while the ballot was still open — the exact
    // disclosure "stars are private until the outcome" forbids. An anonymised
    // entry was rejected too: the row's timestamp still correlates with the
    // voter's other public `vote_cast` entries. Approvals stay logged; they
    // are public by design.
    return buildDetailResponse(
      this.db,
      lineupId,
      userId,
      this.resolveChannelName,
    );
  }

  /**
   * The same four gates `runToggleVote` applies, in the same order, plus a
   * fifth the vote path is missing.
   *
   * ROK-1474: `SetStarSchema` proves only "positive int" and the FK only
   * proves "is a game", so `POST /lineups/7/star {gameId: 999}` used to park
   * an approval row on a game lineup 7 never nominated — and `countVotesPerGame`
   * groups over vote rows, so it would have counted toward `detectTies`. The
   * rejection is a plain-string 400, matching every other gate on this route
   * and the cap rejection in `lineups-voting.helpers.ts`. `toggleVote` has the
   * identical hole; it is filed in TECH-DEBT-BACKLOG rather than fixed here.
   */
  private async loadVotableLineup(
    lineupId: number,
    userId: number,
    gameId: number | null,
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
    if (
      gameId !== null &&
      !(await isGameNominated(this.db, lineupId, gameId))
    ) {
      throw new BadRequestException('Game is not nominated in this lineup');
    }
    return lineup;
  }
}
