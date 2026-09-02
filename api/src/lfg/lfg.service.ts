/**
 * Orchestration for LFG intents (ROK-1451).
 *
 * Deliberately thin: every query lives in `lfg-query.helpers.ts` and every
 * mutation in `lfg-write.helpers.ts`, so this file stays a readable statement
 * of the lifecycle rules rather than a pile of SQL.
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ConvertLfgIntentsDto,
  LfgGroupDetailDto,
  LfgGroupSummaryDto,
  LfgClearOfferDto,
  LfgHeartedGameDto,
  LfgIntentResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { LFG_EVENTS, lfgGroupLockKey } from './lfg.constants';
import {
  getGroupSummary,
  listActiveGroups,
  listGroupMembers,
  listHeartedWithoutIntent,
  requireGame,
  type LfgDb,
} from './lfg-query.helpers';
import { listClearOffers } from './lfg-offers.helpers';
import { resolveTargetGameId } from './lfg-convert.helpers';
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

/** What the serialised insert-then-count transaction settled on. */
interface GroupPostOutcome {
  inserted: LfgIntentRow | null;
  row: LfgIntentRow;
  group: LfgGroupSummaryDto;
  refreshed: boolean;
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
    const outcome = await this.postUnderGroupLock(userId, gameId, game);
    // Post-COMMIT: the transaction above has landed, so a consumer reacting to
    // this event can never read a group that rolled back.
    if (outcome.inserted && outcome.group.activeCount === 2) {
      this.eventEmitter.emit(LFG_EVENTS.LFM_REACHED, {
        gameId,
        activeCount: outcome.group.activeCount,
      });
    }
    if (outcome.refreshed) {
      return {
        created: true,
        body: await this.buildResponse(outcome.row, game, userId),
      };
    }
    return {
      created: outcome.inserted !== null,
      body: { ...toIntentDto(outcome.row), group: outcome.group },
    };
  }

  /**
   * Insert, count and (on a +1) refresh the group inside ONE transaction that
   * holds an advisory lock on the game. Serialising per game is what makes the
   * post-insert `activeCount` exact, so the 1 -> 2 transition is observed
   * exactly once no matter how many posts land together (M2 / Codex P2-b).
   *
   * Every statement uses the `tx` handle — work issued against `this.db` would
   * run on another connection and fall outside the lock.
   */
  private postUnderGroupLock(
    userId: number,
    gameId: number,
    game: typeof schema.games.$inferSelect,
  ): Promise<GroupPostOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
      );
      const inserted = await insertIntent(tx, userId, gameId);
      const row = inserted ?? (await this.resolveExisting(tx, userId, gameId));
      const group = await getGroupSummary(tx, game, userId);
      const refreshed = inserted !== null && group.activeCount >= 2;
      if (refreshed) await refreshGroupExpiry(tx, gameId);
      return { inserted, row, group, refreshed };
    });
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
   * `GET /lfg/offers` — Quick Play sessions that OFFER to clear an intent.
   * Read-only: acting on an offer means calling `DELETE /lfg/:gameId` (AC7c).
   */
  listOffers(userId: number): Promise<LfgClearOfferDto[]> {
    return listClearOffers(this.db, userId);
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
    const participant = await isGroupParticipant(this.db, userId, gameId, dto);
    if (!participant) {
      throw new ForbiddenException(
        'Only a member of this LFG group can convert it',
      );
    }
    await this.requireConversionTarget(gameId, dto);
    const converted = await convertGroup(this.db, gameId, dto);
    return { converted };
  }

  /**
   * The provenance target must exist and belong to the route's game — an
   * unchecked id was either an FK 500 or a false claim recorded against every
   * member of the group.
   */
  private async requireConversionTarget(
    gameId: number,
    target: ConvertLfgIntentsDto,
  ): Promise<void> {
    const targetGameId = await resolveTargetGameId(this.db, target);
    if (targetGameId === undefined) {
      throw new NotFoundException('Conversion target not found');
    }
    if (targetGameId !== gameId) {
      throw new BadRequestException(
        'Conversion target belongs to a different game',
      );
    }
  }

  /** Load a game or 404 — shared with the group-page reads. */
  private requireGame(gameId: number): Promise<typeof schema.games.$inferSelect> {
    return requireGame(this.db, gameId);
  }

  /**
   * The insert lost to the partial unique index: re-read the surviving row and
   * revive it in place when the cron has not yet swept it.
   *
   * @param db - The TRANSACTION handle from {@link postUnderGroupLock}; using
   *   the outer connection here would step outside the advisory lock.
   */
  private async resolveExisting(
    db: LfgDb,
    userId: number,
    gameId: number,
  ): Promise<LfgIntentRow> {
    const existing = await findActiveIntent(db, userId, gameId);
    if (!existing) {
      const retry = await insertIntent(db, userId, gameId);
      if (retry) return retry;
      const settled = await findActiveIntent(db, userId, gameId);
      // Insert lost the race, re-read missed, retry-insert lost again, second
      // re-read STILL missed: that is an internal inconsistency, not a client
      // error. A 404 here would read as a bad request in logs and metrics.
      if (!settled) {
        throw new InternalServerErrorException(
          'LFG intent vanished between conflict and re-read',
        );
      }
      return settled;
    }
    if (existing.expiresAt <= new Date()) {
      return reviveIntent(db, existing.id);
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
