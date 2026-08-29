/**
 * Explicit enrolment of members into a scheduling poll (ROK-1440).
 *
 * A poll's roster is `community_lineup_match_members`, which is normally
 * DERIVED — a user lands in it by voting for the game (`source: 'voted'`) or
 * via interest-based bandwagon clustering (`source: 'bandwagon'`). That left
 * no way for a creator to say "these two are definitely playing, get their
 * availability", so a poll whose `minVoteThreshold` exceeds the derived roster
 * could never reach its lock threshold.
 *
 * This service adds the third path: `source: 'added'`. Widening the enum is
 * type-level only — the column is plain `text` with no CHECK constraint — so
 * no migration is involved.
 *
 * Added members are picked up for free by the reminder path: for a scheduling
 * action `lineup-reminder-target.helpers.ts` resolves candidates via
 * `loadMatchMembers(matchId)`, so a newly added member is reachable by
 * "Remind voters" until they vote.
 *
 * Lives in its own service (like `SchedulingRemindService`) rather than on
 * `SchedulingService`, keeping both files clear of the STRICT max-lines cap.
 */
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { activeUsersFilter } from '../../users/users-active.helpers';
import { findLineupPollMeta } from './scheduling-query.helpers';

/** Caller identity for poll-roster authorization. */
export interface PollMemberCaller {
  id: number;
  role: string;
}

/** Outcome of an add-members call. */
export interface AddMatchMembersResult {
  /** Rows actually inserted (already-present members are skipped). */
  added: number;
  /** Total roster size after the call — the poll's new denominator. */
  memberCount: number;
}

@Injectable()
export class SchedulingMembersService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Enrol users in a match's scheduling poll. Idempotent: re-adding an
   * existing member is a no-op rather than an error, so a double-submit
   * cannot fail or duplicate.
   */
  async addMembers(
    lineupId: number,
    matchId: number,
    userIds: number[],
    caller: PollMemberCaller,
  ): Promise<AddMatchMembersResult> {
    await this.assertCallerMayManage(lineupId, caller);
    await this.assertMatchBelongsToLineup(lineupId, matchId);
    const unique = Array.from(new Set(userIds));
    await this.assertUsersExist(unique);

    const inserted = await this.db
      .insert(schema.communityLineupMatchMembers)
      .values(
        unique.map((userId) => ({ matchId, userId, source: 'added' as const })),
      )
      .onConflictDoNothing({
        target: [
          schema.communityLineupMatchMembers.matchId,
          schema.communityLineupMatchMembers.userId,
        ],
      })
      .returning({ id: schema.communityLineupMatchMembers.id });

    const roster = await this.db
      .select({ id: schema.communityLineupMatchMembers.id })
      .from(schema.communityLineupMatchMembers)
      .where(eq(schema.communityLineupMatchMembers.matchId, matchId));

    return { added: inserted.length, memberCount: roster.length };
  }

  /** Lineup creator OR admin/operator — mirrors `assertCallerMayRemind`. */
  private async assertCallerMayManage(
    lineupId: number,
    caller: PollMemberCaller,
  ): Promise<void> {
    if (caller.role === 'admin' || caller.role === 'operator') return;
    const [lineup] = await findLineupPollMeta(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (lineup.createdBy !== caller.id) {
      throw new ForbiddenException(
        'Only the poll creator or an operator can add participants',
      );
    }
  }

  /** Guard against enrolling into a match that belongs to another lineup. */
  private async assertMatchBelongsToLineup(
    lineupId: number,
    matchId: number,
  ): Promise<void> {
    const [match] = await this.db
      .select({ id: schema.communityLineupMatches.id })
      .from(schema.communityLineupMatches)
      .where(
        and(
          eq(schema.communityLineupMatches.id, matchId),
          eq(schema.communityLineupMatches.lineupId, lineupId),
        ),
      )
      .limit(1);
    if (!match) throw new NotFoundException('Match not found');
  }

  /** Unknown/deactivated ids surface as 404 rather than an FK 500. */
  private async assertUsersExist(userIds: number[]): Promise<void> {
    const found = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(inArray(schema.users.id, userIds), activeUsersFilter()));
    const foundIds = new Set(found.map((r) => r.id));
    const missing = userIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Unknown user id(s): ${missing.join(', ')}`);
    }
  }
}
