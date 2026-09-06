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
  LfgUrgency,
  LfgGroupDetailDto,
  LfgGroupSummaryDto,
  LfgClearOfferDto,
  LfgHeartedGameDto,
  LfgIntentResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  LFG_EVENTS,
  lfgGroupLockKey,
  type LfgGroupChangedPayload,
  type LfgLfmReachedPayload,
} from './lfg.constants';
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
  reviveIntent,
  toIntentDto,
  type LfgIntentRow,
  type LfgUrgencyRequest,
} from './lfg-write.helpers';
import { bumpIntentUrgency, refreshGroupExpiry } from './lfg-urgency.helpers';

/** The class every pre-ROK-1479 caller (`/lfg`, the join listener) still gets. */
const WEEK_REQUEST: LfgUrgencyRequest = { urgency: 'week' };

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
  /** A re-heart moved the caller's OWN row onto a different clock (AC2). */
  bumped: boolean;
}

/** The surviving row a conflicting post settled on, and how it got there. */
interface ResolvedExisting {
  row: LfgIntentRow;
  bumped: boolean;
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
   * @param opts - Requested urgency class (ROK-1479). Defaults to the
   *   pre-1479 `week`, so the Discord `/lfg` command and the join listener
   *   keep their exact behaviour until Lane C threads a class through.
   */
  async createIntent(
    userId: number,
    gameId: number,
    opts: LfgUrgencyRequest = WEEK_REQUEST,
  ): Promise<CreateIntentResult> {
    const game = await this.requireGame(gameId);
    const outcome = await this.postUnderGroupLock(userId, gameId, game, opts);
    // Post-COMMIT: the transaction above has landed, so a consumer reacting to
    // this event can never read a group that rolled back.
    if (outcome.inserted && outcome.group.activeCount === 2) {
      // D7: `urgency` is read off the row that actually landed, not off the
      // request — the request's `ttlMinutes` may be absent and the row is what
      // the DB committed, so the payload can never advertise a class the
      // stored intent does not hold.
      this.eventEmitter.emit(LFG_EVENTS.LFM_REACHED, {
        gameId,
        activeCount: outcome.group.activeCount,
        urgency: outcome.inserted.urgency as LfgUrgency,
      } satisfies LfgLfmReachedPayload);
    }
    // A SIBLING branch, deliberately NOT an `else if`: the two conditions are
    // disjoint by arithmetic (`=== 2` vs `>= 3`), and that disjointness is what
    // the "never both" test guards (AC11). Chaining them would make the
    // boundary unreachable, so a later widening of `>= 3` would ship silently
    // past a green suite. A consumer that saw both events would post a message
    // and immediately edit it.
    if (outcome.inserted && outcome.group.activeCount >= 3) {
      this.emitGroupChanged({ gameId, reason: 'joined' });
    }
    // D8: a bump takes the `inserted === null` branch, so it is disjoint from
    // both emits above. Gated on `>= 2` to match `emitGroupChanged`'s contract
    // — a group nobody has joined yet has no Discord post to re-render.
    if (outcome.bumped && outcome.group.activeCount >= 2) {
      this.emitGroupChanged({ gameId, reason: 'bumped' });
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
    opts: LfgUrgencyRequest,
  ): Promise<GroupPostOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${lfgGroupLockKey(gameId)}))`,
      );
      const inserted = await insertIntent(tx, userId, gameId, opts);
      const settled: ResolvedExisting = inserted
        ? { row: inserted, bumped: false }
        : await this.resolveExisting(tx, userId, gameId, opts);
      const group = await getGroupSummary(tx, game, userId);
      const refreshed = inserted !== null && group.activeCount >= 2;
      if (refreshed) await refreshGroupExpiry(tx, gameId);
      return { inserted, group, refreshed, ...settled };
    });
  }

  /** `DELETE /lfg/:gameId` — withdraw the caller's own intent. */
  async withdraw(userId: number, gameId: number): Promise<void> {
    const cleared = await clearIntent(this.db, userId, gameId);
    if (!cleared) {
      throw new NotFoundException('No active LFG intent for this game');
    }
    this.emitGroupChanged({ gameId, reason: 'withdrawn' });
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
    // Zero rows means this is a retry of an already-converted group (E5): the
    // target message is terminal, so re-announcing it would re-render a card
    // nobody changed.
    if (converted > 0) {
      this.emitGroupChanged({
        gameId,
        reason: 'converted',
        pollId: dto.pollId,
        eventId: dto.eventId,
      });
    }
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

  /**
   * Announce a shape change on a group that has ALREADY reached LFM (D1).
   *
   * Post-commit by construction: every call site awaits its write first, so a
   * consumer can never read a group that rolled back. Deliberately carries no
   * member count — the consumer re-reads, which is what stops a burst of
   * changes from rendering a stale number.
   *
   * @param payload - Which game changed and why. `pollId` / `eventId` are set
   *   only for `converted`, and are passed through as `undefined` rather than
   *   `null` because `convertedToTarget` branches on `!== undefined` (D5).
   */
  private emitGroupChanged(payload: LfgGroupChangedPayload): void {
    this.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, payload);
  }

  /** Load a game or 404 — shared with the group-page reads. */
  private requireGame(
    gameId: number,
  ): Promise<typeof schema.games.$inferSelect> {
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
    opts: LfgUrgencyRequest,
  ): Promise<ResolvedExisting> {
    const existing = await findActiveIntent(db, userId, gameId);
    if (!existing) {
      return {
        row: await this.insertOrSettle(db, userId, gameId, opts),
        bumped: false,
      };
    }
    // A lapsed-but-unswept row is revived ON THE REQUESTED CLASS, so the
    // revive is already the write the caller asked for — bumping it again
    // would be a second UPDATE writing the same horizon.
    if (existing.expiresAt <= new Date()) {
      return { row: await reviveIntent(db, existing.id, opts), bumped: false };
    }
    // AC2: the caller already holds a LIVE row, so the only legal write is on
    // that row. `bumpIntentUrgency` returns null for a genuine no-op and for a
    // row another request converted mid-flight; both keep `existing`.
    const bumped = await bumpIntentUrgency(db, existing, opts);
    return { row: bumped ?? existing, bumped: bumped !== null };
  }

  /**
   * The insert lost the conflict but no active row could be read: retry once,
   * then give up loudly.
   *
   * Insert lost the race, re-read missed, retry-insert lost again, second
   * re-read STILL missed — that is an internal inconsistency, not a client
   * error. A 404 here would read as a bad request in logs and metrics.
   */
  private async insertOrSettle(
    db: LfgDb,
    userId: number,
    gameId: number,
    opts: LfgUrgencyRequest,
  ): Promise<LfgIntentRow> {
    const retry = await insertIntent(db, userId, gameId, opts);
    if (retry) return retry;
    const settled = await findActiveIntent(db, userId, gameId);
    if (!settled) {
      throw new InternalServerErrorException(
        'LFG intent vanished between conflict and re-read',
      );
    }
    return settled;
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
