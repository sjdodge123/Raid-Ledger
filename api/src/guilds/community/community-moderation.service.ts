import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  HubBanDto,
  HubBanList,
  HubStatusUpdateDto,
} from '@raid-ledger/contract';
import { publicAvatarUrl } from '../../common/public-avatar-url.helpers';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { isStaff, type GuildActor } from '../guild-access.service';
import {
  archiveHub,
  assertUserExists,
  isLive,
  requireCommunityHub,
  restoreHub,
} from './community-hub.lookup';
import { mayChangeStatus, mayModerate } from './community-ladder.helpers';
import {
  ban,
  findMembership,
  refreshMemberCount,
  swapLeader,
  unban,
} from './community-membership.queries';
import { CommunityMembershipService } from './community-membership.service';
import { HUB_NOT_FOUND } from '../hub-hidden.helpers';

/** ROK-1870 L3 — bans, leader transfer and archive/restore (§2.3–2.5). */
@Injectable()
export class CommunityModerationService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly members: CommunityMembershipService,
  ) {}

  /** GET /hubs/:id/bans — newest first. */
  async listBans(hubId: number): Promise<HubBanList> {
    await requireCommunityHub(this.db, hubId, true);
    const m = schema.hubCommunityMembers;
    const u = schema.users;
    const by = alias(schema.users, 'banned_by_user');
    const rows = await this.db
      .select({
        userId: m.userId,
        username: u.username,
        avatar: u.customAvatarUrl,
        bannedAt: m.bannedAt,
        bannedBy: by.username,
        reason: m.banReason,
      })
      .from(m)
      .innerJoin(u, eq(u.id, m.userId))
      .leftJoin(by, eq(by.id, m.bannedBy))
      .where(and(eq(m.guildId, hubId), isNotNull(m.bannedAt)));
    const items = rows.flatMap((r) =>
      r.bannedAt === null
        ? []
        : [
            {
              userId: r.userId,
              username: r.username,
              avatarUrl: publicAvatarUrl(r.avatar),
              bannedAt: r.bannedAt.toISOString(),
              bannedBy: r.bannedBy,
              reason: r.reason,
            },
          ],
    );
    return {
      items: items.sort((a, b) => b.bannedAt.localeCompare(a.bannedAt)),
    };
  }

  /** PUT /hubs/:id/bans/:userId — idempotent; pre-bans a non-member. */
  async banUser(
    actor: GuildActor,
    hubId: number,
    userId: number,
    body: HubBanDto,
  ): Promise<void> {
    await requireCommunityHub(this.db, hubId, true);
    await assertUserExists(this.db, userId);
    const row = await findMembership(this.db, hubId, userId);
    const liveRole = row !== null && isLive(row) ? row.role : null;
    if (liveRole === 'leader')
      throw new ConflictException('The leader cannot be banned');
    if (!mayModerate(await this.members.role(actor, hubId), liveRole)) {
      throw new ForbiddenException("You can't ban this member");
    }
    await ban(this.db, {
      guildId: hubId,
      userId,
      bannedBy: actor.id,
      reason: body.reason ?? null,
    });
    await refreshMemberCount(this.db, hubId);
  }

  /** DELETE /hubs/:id/bans/:userId — 404 when not banned. */
  async unbanUser(hubId: number, userId: number): Promise<void> {
    await requireCommunityHub(this.db, hubId, true);
    if (!(await unban(this.db, hubId, userId))) {
      throw new NotFoundException('That user is not banned');
    }
  }

  /** POST /hubs/:id/leader — Leader or staff; one swap transaction (D5). */
  async transferLeader(
    actor: GuildActor,
    hubId: number,
    userId: number,
  ): Promise<{ leaderUserId: number }> {
    await requireCommunityHub(this.db, hubId, true);
    await this.members.assertLeader(actor, hubId);
    const target = await this.members.liveTarget(hubId, userId);
    if (target.role === 'leader')
      throw new ConflictException('Already the leader');
    const swapped = await this.db.transaction((tx) =>
      swapLeader(tx, hubId, userId),
    );
    if (!swapped) throw new NotFoundException('Not a member of this hub');
    return { leaderUserId: userId };
  }

  /** PATCH /hubs/:id/status — a Leader archives; only staff restore (M14). */
  async setStatus(
    actor: GuildActor,
    hubId: number,
    body: HubStatusUpdateDto,
  ): Promise<{ status: 'active' | 'archived' }> {
    const hub = await requireCommunityHub(this.db, hubId, false);
    const staff = isStaff(actor);
    const row = await findMembership(this.db, hubId, actor.id);
    if (hub.status === 'proposed' || (!staff && !isLive(row))) {
      throw new NotFoundException(HUB_NOT_FOUND);
    }
    const role = staff ? 'leader' : (row?.role ?? 'visitor');
    if (!mayChangeStatus(staff, role, body.status)) {
      throw new ForbiddenException(
        staff ? HUB_NOT_FOUND : 'Only an admin can restore a hub',
      );
    }
    if (body.status === hub.status) return { status: body.status };
    if (body.status === 'archived')
      await archiveHub(this.db, hubId, staff ? 'admin' : 'leader');
    else await restoreHub(this.db, hub);
    return { status: body.status };
  }
}
