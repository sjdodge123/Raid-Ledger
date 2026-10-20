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
  GuildSummary,
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
  lockHubRow,
  refreshMemberCount,
  swapLeader,
  unban,
  type DbOrTx,
} from './community-membership.queries';
import {
  CommunityMembershipService,
  LEADER_ONLY,
  ladderRoleOn,
} from './community-membership.service';
import { conflictOnUnique } from './community-db-errors';
import { findProposalUser } from './community-proposals.users';
import { HUB_NOT_FOUND } from '../hub-hidden.helpers';
import { toCommunitySummary } from './community-proposals.service';

const NOT_BANNED = 'That user is not banned';
const NOT_MEMBER = 'Not a member of this hub';

/** A raw ban row of `listBans`. */
interface BanRow {
  userId: number;
  username: string;
  avatar: string | null;
  bannedAt: Date | null;
  bannedBy: string | null;
  reason: string | null;
}

/** Ban rows → contract items, newest first. */
function toBanItems(rows: BanRow[]): HubBanList['items'] {
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
  return items.sort((a, b) => b.bannedAt.localeCompare(a.bannedAt));
}

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
    return { items: toBanItems(rows) };
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
    await this.db.transaction(async (tx) => {
      await lockHubRow(tx, hubId);
      await this.assertMayBan(tx, actor, hubId, userId);
      await ban(tx, {
        guildId: hubId,
        userId,
        bannedBy: actor.id,
        reason: body.reason ?? null,
      });
    });
    await refreshMemberCount(this.db, hubId);
  }

  /** The D7 ban ladder, read under the caller's hub row lock (M22). */
  private async assertMayBan(
    tx: DbOrTx,
    actor: GuildActor,
    hubId: number,
    userId: number,
  ): Promise<void> {
    const row = await findMembership(tx, hubId, userId);
    const liveRole = row !== null && isLive(row) ? row.role : null;
    if (liveRole === 'leader')
      throw new ConflictException('The leader cannot be banned');
    if (!mayModerate(await ladderRoleOn(tx, actor, hubId), liveRole)) {
      throw new ForbiddenException("You can't ban this member");
    }
  }

  /** DELETE /hubs/:id/bans/:userId — 404 when not banned; the D7 ladder. */
  async unbanUser(
    actor: GuildActor,
    hubId: number,
    userId: number,
  ): Promise<void> {
    await requireCommunityHub(this.db, hubId, true);
    const row = await findMembership(this.db, hubId, userId);
    if (row?.bannedAt == null) throw new NotFoundException(NOT_BANNED);
    // Codex r4: a banned row is never live, so a stored `leader` is a former
    // leader who left before a pre-ban — not the hub's Leader. Rank it as a
    // plain member, or no one (staff included) could ever lift the ban.
    const target = row.role === 'leader' ? 'member' : row.role;
    if (!mayModerate(await this.members.role(actor, hubId), target)) {
      throw new ForbiddenException("You can't lift this ban");
    }
    if (!(await unban(this.db, hubId, userId))) {
      throw new NotFoundException(NOT_BANNED);
    }
  }

  /**
   * POST /hubs/:id/leader — Leader or staff; one swap transaction (D5). A
   * missed swap throws INSIDE the transaction, so the demote rolls back.
   */
  async transferLeader(
    actor: GuildActor,
    hubId: number,
    userId: number,
  ): Promise<{ leaderUserId: number }> {
    await requireCommunityHub(this.db, hubId, true);
    await this.members.assertLeader(actor, hubId);
    const user = await findProposalUser(this.db, userId);
    if (user === null || user.deactivatedAt !== null)
      throw new ConflictException('That user is no longer active');
    await conflictOnUnique(
      () =>
        this.db.transaction((tx) =>
          this.swapUnderLock(tx, actor, hubId, userId),
        ),
      'Leadership changed meanwhile — reload and try again',
    );
    return { leaderUserId: userId };
  }

  /**
   * Codex r3: lock the hub row FIRST, then re-read the caller's and the
   * target's roles on `tx` — a racing transfer that already demoted the
   * caller is refused. Only `tx` is used under the lock (no pool reads).
   */
  private async swapUnderLock(
    tx: DbOrTx,
    actor: GuildActor,
    hubId: number,
    userId: number,
  ): Promise<void> {
    await lockHubRow(tx, hubId);
    if ((await ladderRoleOn(tx, actor, hubId)) !== 'leader')
      throw new ForbiddenException(LEADER_ONLY);
    const target = await this.members.liveTarget(hubId, userId, tx);
    if (target.role === 'leader')
      throw new ConflictException('Already the leader');
    if (!(await swapLeader(tx, hubId, userId)))
      throw new NotFoundException(NOT_MEMBER);
  }

  /**
   * PATCH /hubs/:id/status — a Leader archives; only staff restore (M14). A
   * leader of an archived hub is refused upstream by `CommunityLeaderGuard`.
   * A hidden hub is a 404 to non-staff (this route skips `HubVisibleGuard`);
   * archive/restore never touch `hidden_at`.
   */
  async setStatus(
    actor: GuildActor,
    hubId: number,
    body: HubStatusUpdateDto,
  ): Promise<{ status: 'active' | 'archived' }> {
    const hub = await requireCommunityHub(this.db, hubId, false);
    const staff = isStaff(actor);
    const row = await findMembership(this.db, hubId, actor.id);
    const refused = !isLive(row) || hub.hiddenAt !== null;
    if (hub.status === 'proposed' || (!staff && refused)) {
      throw new NotFoundException(HUB_NOT_FOUND);
    }
    const role = staff ? 'leader' : (row?.role ?? 'visitor');
    if (!mayChangeStatus(staff, role, body.status)) {
      throw new ForbiddenException(
        body.status === 'archived'
          ? LEADER_ONLY
          : 'Only an admin can restore a hub',
      );
    }
    if (body.status === hub.status) return { status: body.status };
    if (body.status === 'archived')
      await archiveHub(this.db, hubId, staff ? 'admin' : 'leader');
    else await restoreHub(this.db, hub);
    return { status: body.status };
  }

  /** PATCH /hubs/:id — Leader/Officer/staff edit the blurb (D10). */
  async updateBlurb(
    hubId: number,
    blurb: string | null,
  ): Promise<GuildSummary> {
    await requireCommunityHub(this.db, hubId, true);
    const [row] = await this.db
      .update(schema.guilds)
      .set({ blurb, updatedAt: new Date() })
      .where(eq(schema.guilds.id, hubId))
      .returning();
    if (!row) throw new NotFoundException(HUB_NOT_FOUND);
    return toCommunitySummary(row);
  }
}
