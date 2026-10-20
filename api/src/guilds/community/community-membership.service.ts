import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CommunityHubJoinResponse,
  HubMemberRoleUpdateDto,
  LadderRole,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { isStaff, type GuildActor } from '../guild-access.service';
import { CommunityHubKindAdapter } from './community-hub-kind.adapter';
import {
  archiveHub,
  assertInDiscord,
  countLiveMembers,
  isLive,
  requireCommunityHub,
} from './community-hub.lookup';
import { mayModerate } from './community-ladder.helpers';
import {
  findMembership,
  markLeft,
  refreshMemberCount,
  setRole,
  upsertJoin,
  type HubCommunityMemberRow,
} from './community-membership.queries';

/** The `PATCH …/role` response. */
export interface CommunityMemberRoleResult {
  userId: number;
  role: HubCommunityMemberRow['role'];
  joinedAt: string;
}

/** 403 body of the leader-only routes (matches `GuildLeaderGuard`). */
export const LEADER_ONLY = 'Guild leader access required';

/**
 * ROK-1870 L3 — Join / Leave / Remove / role changes on a community hub
 * (§2.4, D7, D13). Every mutation recounts `guilds.member_count`.
 */
@Injectable()
export class CommunityMembershipService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly adapter: CommunityHubKindAdapter,
  ) {}

  /** POST /hubs/:id/join — idempotent; 403 banned / not in Discord. */
  async join(
    actor: GuildActor,
    hubId: number,
  ): Promise<CommunityHubJoinResponse> {
    await requireCommunityHub(this.db, hubId, true);
    const existing = await findMembership(this.db, hubId, actor.id);
    if (existing?.bannedAt)
      throw new ForbiddenException("You can't join this hub");
    if (!isLive(existing))
      await assertInDiscord(this.db, actor.id, isStaff(actor));
    const row = await upsertJoin(this.db, hubId, actor.id, 'member');
    if (row.bannedAt) throw new ForbiddenException("You can't join this hub");
    return {
      joined: true,
      memberCount: await refreshMemberCount(this.db, hubId),
    };
  }

  /** DELETE /hubs/:id/join — D13: a Leader with company must transfer first. */
  async leave(
    actor: GuildActor,
    hubId: number,
  ): Promise<CommunityHubJoinResponse> {
    await requireCommunityHub(this.db, hubId, true);
    const row = await findMembership(this.db, hubId, actor.id);
    if (isLive(row) && row?.role === 'leader') {
      await this.leaveAsLeader(hubId, actor.id);
    } else {
      await markLeft(this.db, hubId, actor.id, null);
    }
    return {
      joined: false,
      memberCount: await refreshMemberCount(this.db, hubId),
    };
  }

  private async leaveAsLeader(hubId: number, userId: number): Promise<void> {
    if ((await countLiveMembers(this.db, hubId)) > 1) {
      throw new ConflictException('Transfer leadership before leaving');
    }
    await this.db.transaction(async (tx) => {
      await markLeft(tx, hubId, userId, null);
      await archiveHub(tx, hubId, 'empty');
    });
  }

  /** DELETE /hubs/:id/members/:userId — the D7 ladder. */
  async remove(
    actor: GuildActor,
    hubId: number,
    userId: number,
  ): Promise<void> {
    await requireCommunityHub(this.db, hubId, true);
    const target = await this.liveTarget(hubId, userId);
    if (!mayModerate(await this.role(actor, hubId), target.role)) {
      throw new ForbiddenException("You can't remove this member");
    }
    await markLeft(this.db, hubId, userId, actor.id);
    await refreshMemberCount(this.db, hubId);
  }

  /** PATCH /hubs/:id/members/:userId/role — Leader only; never the Leader. */
  async setRole(
    actor: GuildActor,
    hubId: number,
    userId: number,
    body: HubMemberRoleUpdateDto,
  ): Promise<CommunityMemberRoleResult> {
    await requireCommunityHub(this.db, hubId, true);
    await this.assertLeader(actor, hubId);
    const target = await this.liveTarget(hubId, userId);
    if (target.role === 'leader') {
      throw new ConflictException("The leader's role cannot be changed");
    }
    const row = await setRole(this.db, hubId, userId, body.role);
    if (!row) throw new NotFoundException('Not a member of this hub');
    return { userId, role: row.role, joinedAt: row.joinedAt.toISOString() };
  }

  /** The actor's ladder role (staff ⇒ leader). */
  role(actor: GuildActor, hubId: number): Promise<LadderRole> {
    return this.adapter.resolveLadder(actor, hubId);
  }

  /** 403 unless the actor is the hub's Leader or staff. */
  async assertLeader(actor: GuildActor, hubId: number): Promise<void> {
    if ((await this.role(actor, hubId)) !== 'leader') {
      throw new ForbiddenException(LEADER_ONLY);
    }
  }

  /** The target's live row; 404 when they are not a live member. */
  async liveTarget(
    hubId: number,
    userId: number,
  ): Promise<HubCommunityMemberRow> {
    const row = await findMembership(this.db, hubId, userId);
    if (row === null || !isLive(row)) {
      throw new NotFoundException('Not a member of this hub');
    }
    return row;
  }
}
