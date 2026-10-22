import {
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  HubInvitePreview,
  HubInviteJoinResponse,
  HubInviteState,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../hub-hidden.helpers';
import { liveCommunityRole, loadDiscordFields } from '../community-hub.reads';
import { assertMayJoin, joinLocked } from '../community-join.helpers';
import {
  lockHubRow,
  refreshMemberCount,
  type DbOrTx,
} from '../community-membership.queries';
import { isInDiscordGuild } from '../discord-guild-member.helpers';
import { HubDiscordInviteService } from './hub-discord-invite.service';
import {
  inviteState,
  isWellFormedHubInviteToken,
} from './hub-invite-token.helpers';
import {
  bumpUseCount,
  findInviteByToken,
  loadPreviewHub,
  type PreviewHubRow,
} from './hub-invites.queries';

/** One 404 for unknown and malformed tokens. */
export const INVITE_NOT_FOUND = 'Invite link not found';

const GONE_COPY: Record<'expired' | 'revoked' | 'exhausted', string> = {
  expired: 'This invite link has expired',
  revoked: 'This invite link was revoked',
  exhausted: 'This invite link has been used up',
};

/** Links work only on active, visible community hubs (R4). */
function isAvailable(hub: PreviewHubRow | null): hub is PreviewHubRow {
  return (
    hub !== null &&
    hub.kind === 'game_community' &&
    hub.status === 'active' &&
    hub.hiddenAt === null
  );
}

/**
 * The redeem's locked section. Lock order is hub row → invite row, the same
 * order a ban takes (hub lock, then it revokes the banned user's links), so
 * a redeem racing a ban cannot deadlock. The hub is re-read under the lock:
 * hidden or archived since the pre-check → 404 (R4).
 */
async function redeemLocked(
  tx: DbOrTx,
  token: string,
  hubId: number,
  userId: number,
): Promise<boolean> {
  await lockHubRow(tx, hubId);
  if (!isAvailable(await loadPreviewHub(tx, hubId))) {
    throw new NotFoundException(HUB_NOT_FOUND);
  }
  const locked = await findInviteByToken(tx, token, true);
  if (!locked || locked.guildId !== hubId) {
    throw new NotFoundException(INVITE_NOT_FOUND);
  }
  const state = inviteState(locked, new Date());
  if (state !== 'ok') {
    throw new GoneException({ message: GONE_COPY[state], state });
  }
  const fresh = await joinLocked(tx, hubId, userId, 'invite', locked.id);
  if (fresh) await bumpUseCount(tx, locked.id);
  return fresh;
}

/**
 * ROK-1893 P1 — the `/h/:token` landing: a public preview (signed-in viewer
 * fields when a JWT is present) and the redeem. Redeeming is one transaction:
 * lock the hub row, then the invite row, re-check both, join, count a NEW
 * member only.
 */
@Injectable()
export class HubInviteLandingService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly discordInvite: HubDiscordInviteService,
  ) {}

  /** GET /hubs/invites/:token — malformed → 404 without a DB hit. */
  async preview(
    token: string,
    viewerId: number | null,
  ): Promise<HubInvitePreview> {
    const invite = await this.inviteOr404(token);
    const hub = await loadPreviewHub(this.db, invite.guildId);
    const inDiscordServer = await this.inDiscord(viewerId);
    if (!isAvailable(hub)) {
      return this.shape('hub-unavailable', null, false, inDiscordServer, null);
    }
    const state = inviteState(invite, new Date());
    const alreadyMember =
      viewerId !== null &&
      (await liveCommunityRole(this.db, hub.id, viewerId)) !== null;
    const offerDiscord =
      state === 'ok' && !alreadyMember && inDiscordServer !== true;
    const url = offerDiscord
      ? await this.discordInvite.serverInviteUrl(hub.id)
      : null;
    return this.shape(state, hub, alreadyMember, inDiscordServer, url);
  }

  /**
   * POST /hubs/invites/:token/join — 404 unknown link / unavailable hub,
   * 410 expired/revoked/exhausted, 403 banned / not in Discord. A live
   * member re-redeeming gets a 200 no-op and the count does not move.
   */
  async join(token: string, userId: number): Promise<HubInviteJoinResponse> {
    const invite = await this.inviteOr404(token);
    const hub = await loadPreviewHub(this.db, invite.guildId);
    if (!isAvailable(hub)) throw new NotFoundException(HUB_NOT_FOUND);
    if ((await liveCommunityRole(this.db, hub.id, userId)) !== null) {
      return { hubId: hub.id, joined: false, memberCount: hub.memberCount };
    }
    await assertMayJoin(this.db, userId, hub.id, true);
    const joined = await this.db.transaction((tx) =>
      redeemLocked(tx, token, hub.id, userId),
    );
    const memberCount = await refreshMemberCount(this.db, hub.id);
    return { hubId: hub.id, joined, memberCount };
  }

  private async inviteOr404(token: string): Promise<schema.HubInviteSelect> {
    if (!isWellFormedHubInviteToken(token)) {
      throw new NotFoundException(INVITE_NOT_FOUND);
    }
    const invite = await findInviteByToken(this.db, token);
    if (!invite) throw new NotFoundException(INVITE_NOT_FOUND);
    return invite;
  }

  private async inDiscord(viewerId: number | null): Promise<boolean | null> {
    if (viewerId === null) return null;
    const fields = await loadDiscordFields(this.db, viewerId);
    return fields !== null && isInDiscordGuild(fields);
  }

  private shape(
    state: HubInviteState,
    hub: PreviewHubRow | null,
    alreadyMember: boolean,
    inDiscordServer: boolean | null,
    discordServerInviteUrl: string | null,
  ): HubInvitePreview {
    return {
      state,
      hub:
        hub === null
          ? null
          : {
              id: hub.id,
              name: hub.name,
              gameName: hub.gameName,
              gameCoverUrl: hub.gameCoverUrl,
              memberCount: hub.memberCount,
              blurb: hub.blurb,
            },
      alreadyMember,
      inDiscordServer,
      discordServerInviteUrl,
    };
  }
}
