/**
 * Private standalone polls shared by link (ROK-1750).
 *
 * - `preview`: the un-authed landing card — minimal fields only, never the
 *   member list, slot times or Discord ids (spec §3).
 * - `join`: the signed-in visitor becomes an invitee (+ a match member while
 *   the poll is open), so the existing view / vote guards pass unchanged.
 * - `reset`: creator / admin rotate the token; existing invitees keep access.
 *
 * Unknown, malformed and reset tokens share ONE 404 body. Tokens are never
 * logged — only lineup / match ids.
 */
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  PollShareJoinResponseDto,
  PollSharePreviewDto,
  PollShareTokenResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { pollStatusFromMatch } from '../scheduling/scheduling-poll-embed.helpers';
import { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import {
  canResetShareToken,
  isWellFormedShareToken,
  redeemAddsRows,
} from './standalone-poll-share.helpers';
import {
  countPollMembers,
  findPollByShareToken,
  findPrivatePollByMatchId,
  findSlotTimes,
  insertInvitees,
  insertMatchMember,
  rotateShareToken,
  type SharedPoll,
} from './standalone-poll-share-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** One body for unknown / malformed / reset tokens — no distinction. */
const INVALID_LINK = 'This link is no longer valid';

/** The caller, as the join / reset paths need it. */
export interface ShareCaller {
  id: number;
  isAdmin: boolean;
}

@Injectable()
export class StandalonePollShareService {
  private readonly logger = new Logger(StandalonePollShareService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly pollEmbed: SchedulingPollEmbedService,
  ) {}

  /** GET /scheduling-polls/share/:token — the signed-out landing card. */
  async preview(token: string): Promise<PollSharePreviewDto> {
    const poll = await this.resolve(this.db, token);
    const [isOpen, memberCount] = await Promise.all([
      this.isOpen(this.db, poll),
      countPollMembers(this.db, poll.matchId),
    ]);
    return {
      gameName: poll.gameName,
      gameCoverUrl: poll.gameCoverUrl,
      creatorDisplayName: poll.creatorDisplayName,
      isOpen,
      memberCount,
    };
  }

  /**
   * POST /scheduling-polls/share/:token/join — idempotent redeem (spec D4).
   * Closed polls grant the invitee row only (result page access, no vote).
   */
  async join(
    token: string,
    caller: ShareCaller,
  ): Promise<PollShareJoinResponseDto> {
    const result = await this.db.transaction(async (tx) => {
      const poll = await this.resolve(tx, token);
      const ids = { lineupId: poll.lineupId, matchId: poll.matchId };
      if (!redeemAddsRows(caller.id, caller.isAdmin, poll.createdBy)) {
        return { ...ids, joined: false };
      }
      const added = await insertInvitees(
        tx,
        poll.lineupId,
        [caller.id],
        poll.createdBy,
      );
      if (await this.isOpen(tx, poll)) {
        await insertMatchMember(tx, poll.matchId, caller.id);
      }
      return { ...ids, joined: added > 0 };
    });
    if (result.joined) {
      this.logger.log(`Link visitor joined poll (match ${result.matchId})`);
      // Nudge open poll pages (private polls have no Discord card to edit).
      this.pollEmbed.fireUpdateEmbed(result.matchId);
    }
    return result;
  }

  /** POST /scheduling-polls/:matchId/share-token/reset — creator / admin. */
  async reset(
    matchId: number,
    caller: ShareCaller,
  ): Promise<PollShareTokenResponseDto> {
    const poll = await findPrivatePollByMatchId(this.db, matchId);
    if (!poll) throw new NotFoundException('Poll not found');
    if (!canResetShareToken(caller.id, caller.isAdmin, poll.createdBy)) {
      throw new ForbiddenException(
        'Only the poll creator or an admin can reset the link',
      );
    }
    const shareToken = await rotateShareToken(this.db, poll.lineupId);
    this.logger.log(`Share link reset for poll (match ${matchId})`);
    return { shareToken };
  }

  /** Token → poll, or the single invalid-link 404. */
  private async resolve(
    db: Parameters<typeof findPollByShareToken>[0],
    token: string,
  ): Promise<SharedPoll> {
    const poll = isWellFormedShareToken(token)
      ? await findPollByShareToken(db, token)
      : null;
    if (!poll) throw new NotFoundException(INVALID_LINK);
    return poll;
  }

  /** Same open/closed rule as `assertPollOpen` and the poll page. */
  private async isOpen(
    db: Parameters<typeof findSlotTimes>[0],
    poll: SharedPoll,
  ): Promise<boolean> {
    const slotTimes = await findSlotTimes(db, poll.matchId);
    const status = pollStatusFromMatch({
      matchStatus: poll.matchStatus,
      lineupStatus: poll.lineupStatus,
      phaseDeadline: poll.phaseDeadline,
      linkedEventId: poll.linkedEventId,
      slotTimes,
    });
    return status === 'open';
  }
}
