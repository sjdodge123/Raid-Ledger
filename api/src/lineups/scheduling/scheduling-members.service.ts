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
 * ROK-2020 adds the inverse — `removeMember` — under the same permission
 * rule. Both re-render the Discord poll card AFTER their write commits (via
 * `SchedulingPollEmbedService.fireUpdateEmbed`), so the card's counts move.
 *
 * Lives in its own service (like `SchedulingRemindService`) rather than on
 * `SchedulingService`, keeping both files clear of the STRICT max-lines cap.
 */
import {
  BadRequestException,
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
import {
  assertSchedulable,
  assertSchedulingEnabled,
} from './scheduling-guard.helpers';
import { addInvitees } from '../lineups-invitees.helpers';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import {
  countMatchMembers,
  deleteMatchMemberWithVotes,
} from './scheduling-members-remove.helpers';

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

/** Outcome of a remove-member call (ROK-2020). */
export interface RemoveMatchMemberResult {
  /** That user's vote rows deleted from this poll's slots (yes and no). */
  removedVotes: number;
  /** Total roster size after the call — the poll's new denominator. */
  memberCount: number;
}

@Injectable()
export class SchedulingMembersService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly pollEmbed: SchedulingPollEmbedService,
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
    const lineup = await this.loadSchedulableMatch(lineupId, matchId);
    const unique = Array.from(new Set(userIds));
    await this.assertUsersExist(unique);

    // Codex P2: on a PRIVATE lineup, match membership alone is not enough to
    // participate — `assertCallerMayVote` gates voting/suggesting on
    // creator|invitee|admin, and private reminders start from the invitee
    // set. Enrolling a non-invitee would create a member who can never vote
    // yet still inflates the denominator, making the lock HARDER to reach —
    // the exact failure this story exists to remove. So mirror the roster
    // into the invitee list; `addInvitees` is itself idempotent.
    if (lineup.visibility === 'private') {
      // ROK-1101 G2: the enrolling caller is the effective inviter.
      await addInvitees(this.db, lineupId, unique, caller.id);
    }

    const added = await this.insertAddedMembers(matchId, unique);

    // ROK-2020 (OPEN-4): after the insert has landed, so the card's
    // "N of M" counts move on add too.
    this.pollEmbed.fireUpdateEmbed(matchId);
    return {
      added,
      memberCount: await countMatchMembers(this.db, matchId),
    };
  }

  /**
   * Take one user off a match's scheduling poll (ROK-2020): their roster row
   * and every stance they hold on this poll's slots go in one transaction.
   * Not a ban — a removed user who votes again is re-enrolled by
   * `ensureMatchMember`. The poll creator cannot be removed (cancel the poll
   * instead). No DM is sent to the removed user.
   */
  async removeMember(
    lineupId: number,
    matchId: number,
    userId: number,
    caller: PollMemberCaller,
  ): Promise<RemoveMatchMemberResult> {
    const createdBy = await this.assertCallerMayManage(lineupId, caller);
    await this.loadSchedulableMatch(lineupId, matchId);
    if (userId === createdBy) {
      throw new BadRequestException(
        "The poll creator can't be removed — cancel the poll instead",
      );
    }
    const removed = await deleteMatchMemberWithVotes(this.db, matchId, userId);
    if (removed.removedVotes === 0 && removed.removedMembers === 0) {
      throw new NotFoundException('Not a participant of this poll');
    }
    // After the transaction has committed — never inside it.
    this.pollEmbed.fireUpdateEmbed(matchId);
    return {
      removedVotes: removed.removedVotes,
      memberCount: await countMatchMembers(this.db, matchId),
    };
  }

  /**
   * Lineup creator OR admin/operator — mirrors `assertCallerMayRemind`.
   * Returns the lineup's creator id (the remove path refuses to remove them).
   */
  private async assertCallerMayManage(
    lineupId: number,
    caller: PollMemberCaller,
  ): Promise<number> {
    const [lineup] = await findLineupPollMeta(this.db, lineupId);
    if (!lineup) throw new NotFoundException('Lineup not found');
    if (caller.role === 'admin' || caller.role === 'operator') {
      return lineup.createdBy;
    }
    if (lineup.createdBy !== caller.id) {
      throw new ForbiddenException(
        'Only the poll creator or an operator can manage participants',
      );
    }
    return lineup.createdBy;
  }

  /**
   * Resolve the match, proving it belongs to this lineup AND that the poll is
   * still open. Codex P2: every other scheduling mutation rejects a
   * scheduled/archived match and a lineup that opted out of the scheduling
   * phase; without these the endpoint could mutate rosters the UI renders as
   * read-only. Returns the parent lineup's visibility for the private-invitee
   * mirror above.
   */
  private async loadSchedulableMatch(
    lineupId: number,
    matchId: number,
  ): Promise<{ visibility: string }> {
    const [match] = await this.db
      .select({
        status: schema.communityLineupMatches.status,
        visibility: schema.communityLineups.visibility,
        includeSchedulingPhase: schema.communityLineups.includeSchedulingPhase,
      })
      .from(schema.communityLineupMatches)
      .innerJoin(
        schema.communityLineups,
        eq(schema.communityLineupMatches.lineupId, schema.communityLineups.id),
      )
      .where(
        and(
          eq(schema.communityLineupMatches.id, matchId),
          eq(schema.communityLineupMatches.lineupId, lineupId),
        ),
      )
      .limit(1);
    if (!match) throw new NotFoundException('Match not found');
    assertSchedulingEnabled(match);
    assertSchedulable(match);
    return { visibility: match.visibility };
  }

  /** Insert `source: 'added'` rows, skipping existing members; returns the count. */
  private async insertAddedMembers(
    matchId: number,
    userIds: number[],
  ): Promise<number> {
    const inserted = await this.db
      .insert(schema.communityLineupMatchMembers)
      .values(
        userIds.map((userId) => ({
          matchId,
          userId,
          source: 'added' as const,
        })),
      )
      .onConflictDoNothing({
        target: [
          schema.communityLineupMatchMembers.matchId,
          schema.communityLineupMatchMembers.userId,
        ],
      })
      .returning({ id: schema.communityLineupMatchMembers.id });
    return inserted.length;
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
