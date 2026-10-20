import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AdminCreateHubDto,
  ApproveHubProposalDto,
  CreateHubProposalDto,
  GuildSummary,
  HubProposal,
  HubProposalList,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import type { CreateNotificationInput } from '../../notifications/notification.types';
import { isStaff, type GuildActor } from '../guild-access.service';
import { toGuildSummary } from '../guild-core.queries';
import {
  refreshMemberCount,
  upsertJoin,
  type DbOrTx,
} from './community-membership.queries';
import * as q from './community-proposals.queries';
import { findProposalUser, staffUserIds } from './community-proposals.users';
import { isInDiscordGuild } from './discord-guild-member.helpers';
import {
  approvedNotice,
  rejectedNotice,
  submittedNotice,
} from './hub-proposal-notices';

/** §2.3 error copy (the web shows these verbatim). */
export const PROPOSAL_ERRORS = {
  notInDiscord: 'Join the community Discord server to propose hubs',
  nameTaken: 'A hub with that name already exists for this game',
  pendingForGame: 'You already have a proposal waiting for this game',
  limit: 'You can have at most 2 hub proposals waiting for review',
  proposerInactive:
    'The proposer is no longer active — create the hub directly',
  leaderInactive: 'That user is no longer active',
  notFound: 'Hub proposal not found',
} as const;

/** D12: open proposals per user overall. */
export const MAX_OPEN_PROPOSALS = 2;

/** A community hub row → `GuildSummary` with the ROK-1870 fields. */
export function toCommunitySummary(row: schema.GuildSelect): GuildSummary {
  return { ...toGuildSummary(row), status: row.status, blurb: row.blurb };
}

/** ROK-1870 L2b — propose / withdraw / review / admin-create (§2.4). */
@Injectable()
export class CommunityProposalsService {
  private readonly logger = new Logger(CommunityProposalsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationService,
  ) {}

  /** A2 → game → D12 limits → D11 name → insert `proposed` → notify staff. */
  async propose(
    actor: GuildActor,
    dto: CreateHubProposalDto,
  ): Promise<HubProposal> {
    const user = await findProposalUser(this.db, actor.id);
    if (!user) throw new NotFoundException('User not found');
    if (!isStaff(actor) && !isInDiscordGuild(user)) {
      throw new ForbiddenException(PROPOSAL_ERRORS.notInDiscord);
    }
    await this.requireGame(dto.gameId);
    await this.assertWithinLimits(actor.id, dto.gameId);
    await this.assertNameFree(this.db, dto.gameId, dto.name, null);
    const row = await q.insertCommunityHub(this.db, {
      ...dto,
      status: 'proposed',
      proposedBy: actor.id,
      reviewedBy: null,
    });
    const proposal = await this.findProposal(row.id);
    const staff = await staffUserIds(this.db);
    const facts = factsOf(proposal);
    await this.send(
      staff.map((id) => submittedNotice(id, facts, user.username)),
    );
    return proposal;
  }

  /** The caller's open proposals. */
  async mine(userId: number): Promise<HubProposalList> {
    return { items: await q.listProposals(this.db, { proposedBy: userId }) };
  }

  /** The proposer withdraws; 404 when not theirs or no longer proposed. */
  async withdraw(userId: number, id: number): Promise<void> {
    if (!(await q.deleteProposal(this.db, id, userId))) {
      throw new NotFoundException(PROPOSAL_ERRORS.notFound);
    }
  }

  /** The staff queue, oldest first. */
  async queue(): Promise<HubProposalList> {
    return { items: await q.listProposals(this.db) };
  }

  /** D8: activate, seat the proposer as Leader, count — one transaction. */
  async approve(
    adminId: number,
    id: number,
    dto: ApproveHubProposalDto,
  ): Promise<GuildSummary> {
    const { row, proposerId } = await this.db.transaction(async (tx) => {
      const locked = await q.lockProposal(tx, id);
      if (!locked) throw new NotFoundException(PROPOSAL_ERRORS.notFound);
      const proposer = await this.activeProposer(tx, locked.proposedBy);
      if (dto.name !== undefined)
        await this.assertNameFree(tx, locked.gameId, dto.name, id);
      const active = await q.activateProposal(tx, id, {
        reviewedBy: adminId,
        ...dto,
      });
      await upsertJoin(tx, id, proposer, 'leader');
      const memberCount = await refreshMemberCount(tx, id);
      return { row: { ...active, memberCount }, proposerId: proposer };
    });
    const gameName = (await q.findGameName(this.db, row.gameId)) ?? 'your game';
    await this.send([
      approvedNotice(proposerId, {
        proposalId: id,
        gameName,
        hubName: row.name,
      }),
    ]);
    return toCommunitySummary(row);
  }

  /** A1: notify the proposer with the reason, THEN delete the row. */
  async reject(id: number, reason: string): Promise<void> {
    const proposal = await this.findProposal(id);
    await this.send([
      rejectedNotice(proposal.proposedBy.userId, factsOf(proposal), reason),
    ]);
    if (!(await q.deleteProposal(this.db, id))) {
      throw new NotFoundException(PROPOSAL_ERRORS.notFound);
    }
  }

  /** `POST /admin/hubs` — an active hub led by `leaderUserId`. */
  async createDirect(
    adminId: number,
    dto: AdminCreateHubDto,
  ): Promise<GuildSummary> {
    await this.requireGame(dto.gameId);
    const leader = await findProposalUser(this.db, dto.leaderUserId);
    if (!leader) throw new NotFoundException('User not found');
    if (leader.deactivatedAt !== null) {
      throw new ConflictException(PROPOSAL_ERRORS.leaderInactive);
    }
    await this.assertNameFree(this.db, dto.gameId, dto.name, null);
    const row = await this.db.transaction(async (tx) => {
      const hub = await q.insertCommunityHub(tx, {
        gameId: dto.gameId,
        name: dto.name,
        blurb: dto.blurb,
        status: 'active',
        proposedBy: null,
        reviewedBy: adminId,
      });
      await upsertJoin(tx, hub.id, leader.id, 'leader');
      return { ...hub, memberCount: await refreshMemberCount(tx, hub.id) };
    });
    return toCommunitySummary(row);
  }

  private async requireGame(gameId: number): Promise<string> {
    const name = await q.findGameName(this.db, gameId);
    if (name === null) throw new NotFoundException('Game not found');
    return name;
  }

  private async assertWithinLimits(
    userId: number,
    gameId: number,
  ): Promise<void> {
    const open = await q.openProposalGameIds(this.db, userId);
    if (open.includes(gameId))
      throw new ConflictException(PROPOSAL_ERRORS.pendingForGame);
    if (open.length >= MAX_OPEN_PROPOSALS)
      throw new ConflictException(PROPOSAL_ERRORS.limit);
  }

  private async assertNameFree(
    db: DbOrTx,
    gameId: number,
    name: string,
    exceptId: number | null,
  ): Promise<void> {
    if (await q.hasNameClash(db, gameId, name, exceptId)) {
      throw new ConflictException(PROPOSAL_ERRORS.nameTaken);
    }
  }

  /** P9: the proposer must still be an active account. */
  private async activeProposer(
    tx: DbOrTx,
    proposedBy: number | null,
  ): Promise<number> {
    const user =
      proposedBy === null ? null : await findProposalUser(tx, proposedBy);
    if (!user || user.deactivatedAt !== null) {
      throw new ConflictException(PROPOSAL_ERRORS.proposerInactive);
    }
    return user.id;
  }

  private async findProposal(id: number): Promise<HubProposal> {
    const [proposal] = await q.listProposals(this.db, { ids: [id] });
    if (!proposal) throw new NotFoundException(PROPOSAL_ERRORS.notFound);
    return proposal;
  }

  /** Fire every notice; a failed one is logged, never fails the request. */
  private async send(inputs: CreateNotificationInput[]): Promise<void> {
    const results = await Promise.allSettled(
      inputs.map((i) => this.notifications.create(i)),
    );
    for (const r of results) {
      if (r.status === 'rejected')
        this.logger.warn(`Hub proposal notice failed: ${String(r.reason)}`);
    }
  }
}

function factsOf(p: HubProposal): {
  proposalId: number;
  gameName: string;
  hubName: string;
} {
  return { proposalId: p.id, gameName: p.gameName, hubName: p.name };
}
