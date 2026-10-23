import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  HUB_INVITES_PER_MEMBER,
  type CreateHubInviteDto,
  type HubInvite,
  type HubInviteList,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { isStaff, type GuildActor } from '../../guild-access.service';
import { assertNotHidden } from '../../hub-hidden.helpers';
import { requireCommunityHub } from '../community-hub.lookup';
import { lockHubRow } from '../community-membership.queries';
import { ladderRoleOn } from '../community-membership.service';
import {
  canRevokeInvite,
  expiryFrom,
  generateHubInviteToken,
  INVITE_CAP_MESSAGE,
  inviteUrl,
  managesInvites,
  type InviteViewer,
} from './hub-invite-token.helpers';
import {
  countLiveByMaker,
  findInvite,
  insertInvite,
  listInvites,
  revokeInvite,
  type InviteWithMaker,
} from './hub-invites.queries';

/** 403 copy for a non-member on the member-only invite routes. */
export const MEMBERS_ONLY = 'Only hub members can manage invite links';

/**
 * ROK-1893 P1 — list / create / revoke a hub's invite links (§4.1 + §8a/§8d).
 * Any live member (or staff) creates; a member sees their own links,
 * Leader/Officer/staff see all; the maker, Leader/Officer or staff revoke.
 */
@Injectable()
export class HubInvitesService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  /** GET /hubs/:id/invites */
  async list(actor: GuildActor, hubId: number): Promise<HubInviteList> {
    const viewer = await this.viewer(actor, hubId);
    const makerId = managesInvites(viewer) ? null : actor.id;
    const rows = await listInvites(this.db, hubId, makerId);
    const clientUrl = await this.settings.getClientUrl();
    const mine = await countLiveByMaker(this.db, hubId, actor.id, new Date());
    return {
      items: rows.map((r) => toHubInvite(r, viewer, clientUrl)),
      liveByViewer: mine,
      perMemberCap: HUB_INVITES_PER_MEMBER,
    };
  }

  /** POST /hubs/:id/invites — 409 at the per-member live-link cap. */
  async create(
    actor: GuildActor,
    hubId: number,
    body: CreateHubInviteDto,
  ): Promise<HubInvite> {
    const viewer = await this.viewer(actor, hubId);
    const now = new Date();
    // The hub row lock serialises two creates by one maker against the cap.
    const row = await this.db.transaction(async (tx) => {
      await lockHubRow(tx, hubId);
      if (
        (await countLiveByMaker(tx, hubId, actor.id, now)) >=
        HUB_INVITES_PER_MEMBER
      ) {
        throw new ConflictException(INVITE_CAP_MESSAGE);
      }
      return insertInvite(tx, {
        guildId: hubId,
        token: generateHubInviteToken(),
        createdBy: actor.id,
        expiresAt: expiryFrom(body.expiresInHours, now),
        maxUses: body.maxUses ?? null,
      });
    });
    const maker = { id: actor.id, displayName: await this.nameOf(actor.id) };
    const clientUrl = await this.settings.getClientUrl();
    return toHubInvite({ invite: row, maker }, viewer, clientUrl);
  }

  /** DELETE /hubs/:id/invites/:inviteId — sets `revoked_at`. */
  async revoke(
    actor: GuildActor,
    hubId: number,
    inviteId: number,
  ): Promise<void> {
    const viewer = await this.viewer(actor, hubId);
    const invite = await findInvite(this.db, hubId, inviteId);
    if (!invite) throw new NotFoundException('Invite link not found');
    if (!canRevokeInvite(viewer, invite.createdBy)) {
      throw new ForbiddenException("You can't revoke this invite link");
    }
    await revokeInvite(this.db, inviteId);
  }

  /** 404 unless an active, visible community hub; 403 unless member/staff. */
  private async viewer(
    actor: GuildActor,
    hubId: number,
  ): Promise<InviteViewer> {
    await requireCommunityHub(this.db, hubId, true);
    await assertNotHidden(this.db, actor, hubId);
    const role = await ladderRoleOn(this.db, actor, hubId);
    const staff = isStaff(actor);
    if (!staff && role === 'visitor')
      throw new ForbiddenException(MEMBERS_ONLY);
    return { userId: actor.id, role, staff };
  }

  private async nameOf(userId: number): Promise<string> {
    const u = schema.users;
    const [row] = await this.db
      .select({ username: u.username, displayName: u.displayName })
      .from(u)
      .where(eq(u.id, userId))
      .limit(1);
    return row?.displayName ?? row?.username ?? '';
  }
}

/** Row → contract shape; `token`/`url` only for those who may revoke it. */
export function toHubInvite(
  { invite, maker }: InviteWithMaker,
  viewer: InviteViewer,
  clientUrl: string,
): HubInvite {
  const canRevoke = canRevokeInvite(viewer, invite.createdBy);
  return {
    id: invite.id,
    token: canRevoke ? invite.token : null,
    url: canRevoke ? inviteUrl(clientUrl, invite.token) : null,
    createdBy: maker,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    maxUses: invite.maxUses,
    useCount: invite.useCount,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    canRevoke,
  };
}
