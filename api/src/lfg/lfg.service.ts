/**
 * Orchestration for LFG intents (ROK-1451).
 *
 * Deliberately thin: every query lives in `lfg-query.helpers.ts` and every
 * mutation in `lfg-write.helpers.ts`, so this file stays a readable statement
 * of the lifecycle rules rather than a pile of SQL.
 */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ConvertLfgIntentsDto,
  LfgGroupDetailDto,
  LfgGroupSummaryDto,
  LfgHeartedGameDto,
  LfgIntentResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { LFG_EVENTS } from './lfg.constants';
import {
  getGroupSummary,
  listActiveGroups,
  listGroupMembers,
  listHeartedWithoutIntent,
} from './lfg-query.helpers';
import {
  clearIntent,
  convertGroup,
  findActiveIntent,
  insertIntent,
  isGroupParticipant,
  refreshGroupExpiry,
  reviveIntent,
  toIntentDto,
  type LfgIntentRow,
} from './lfg-write.helpers';

/** `POST /lfg` result — `created` drives the 201-vs-200 status code. */
export interface CreateIntentResult {
  created: boolean;
  body: LfgIntentResponseDto;
}

@Injectable()
export class LfgService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Post an intent. Race-safe: the partial unique index decides the winner and
   * the loser re-reads the surviving row (200) instead of erroring.
   *
   * @param userId - Caller.
   * @param gameId - Game the caller wants to play.
   */
  async createIntent(
    userId: number,
    gameId: number,
  ): Promise<CreateIntentResult> {
    const game = await this.requireGame(gameId);
    const inserted = await insertIntent(this.db, userId, gameId);
    const row = inserted ?? (await this.resolveExisting(userId, gameId));
    const group = await getGroupSummary(this.db, game, userId);
    if (inserted && group.activeCount >= 2) {
      await refreshGroupExpiry(this.db, gameId);
      if (group.activeCount === 2) {
        this.eventEmitter.emit(LFG_EVENTS.LFM_REACHED, {
          gameId,
          activeCount: group.activeCount,
        });
      }
      return { created: true, body: await this.buildResponse(row, game, userId) };
    }
    return {
      created: inserted !== null,
      body: { ...toIntentDto(row), group },
    };
  }

  /** `DELETE /lfg/:gameId` — withdraw the caller's own intent. */
  async withdraw(userId: number, gameId: number): Promise<void> {
    const cleared = await clearIntent(this.db, userId, gameId);
    if (!cleared) {
      throw new NotFoundException('No active LFG intent for this game');
    }
  }

  /** `GET /lfg` — every game somebody is actively looking for. */
  listGroups(userId: number): Promise<LfgGroupSummaryDto[]> {
    return listActiveGroups(this.db, userId);
  }

  /** `GET /lfg/:gameId` — group detail, including an empty-group read. */
  async getGroupDetail(
    userId: number,
    gameId: number,
  ): Promise<LfgGroupDetailDto> {
    const game = await this.requireGame(gameId);
    const [summary, members, own] = await Promise.all([
      getGroupSummary(this.db, game, userId),
      listGroupMembers(this.db, gameId),
      findActiveIntent(this.db, userId, gameId),
    ]);
    const live = own && own.expiresAt > new Date() ? own : null;
    return {
      ...summary,
      members,
      ownIntent: live ? toIntentDto(live) : null,
    };
  }

  /** `GET /lfg/hearted` — cold-start suggestions. Read-only by construction. */
  listHearted(userId: number): Promise<LfgHeartedGameDto[]> {
    return listHeartedWithoutIntent(this.db, userId);
  }

  /**
   * `POST /lfg/:gameId/convert` — record that this group became a poll/event.
   * Never creates the poll or event itself; the caller does that first.
   *
   * @param userId - Caller, who must have taken part in the group.
   * @param gameId - Game whose group converted.
   * @param dto - Exactly one of `pollId` / `eventId`.
   */
  async convert(
    userId: number,
    gameId: number,
    dto: ConvertLfgIntentsDto,
  ): Promise<{ converted: number }> {
    await this.requireGame(gameId);
    const participant = await isGroupParticipant(this.db, userId, gameId);
    if (!participant) {
      throw new ForbiddenException(
        'Only a member of this LFG group can convert it',
      );
    }
    const converted = await convertGroup(this.db, gameId, dto);
    return { converted };
  }

  /** Load a game or 404. */
  private async requireGame(
    gameId: number,
  ): Promise<typeof schema.games.$inferSelect> {
    const [game] = await this.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /**
   * The insert lost to the partial unique index: re-read the surviving row and
   * revive it in place when the cron has not yet swept it.
   */
  private async resolveExisting(
    userId: number,
    gameId: number,
  ): Promise<LfgIntentRow> {
    const existing = await findActiveIntent(this.db, userId, gameId);
    if (!existing) {
      const retry = await insertIntent(this.db, userId, gameId);
      if (retry) return retry;
      const settled = await findActiveIntent(this.db, userId, gameId);
      if (!settled) throw new NotFoundException('LFG intent not found');
      return settled;
    }
    if (existing.expiresAt <= new Date()) {
      return reviveIntent(this.db, existing.id);
    }
    return existing;
  }

  /** Re-read the intent after a group-wide expiry refresh moved its clock. */
  private async buildResponse(
    row: LfgIntentRow,
    game: typeof schema.games.$inferSelect,
    userId: number,
  ): Promise<LfgIntentResponseDto> {
    const [fresh] = await this.db
      .select()
      .from(schema.lfgIntents)
      .where(eq(schema.lfgIntents.id, row.id))
      .limit(1);
    const group = await getGroupSummary(this.db, game, userId);
    return { ...toIntentDto(fresh ?? row), group };
  }
}
