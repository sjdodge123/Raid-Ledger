/**
 * ROK-1957 D-2 / D-15 — who may use a BG3 hub route. Missing hub, a hub that
 * is not a `game_community` hub of BG3, or one hidden from the viewer → 404
 * `Guild not found` (the Valheim `refuseHiddenHub` body); a visible hub and a
 * signed-in non-member → 403; staff pass. Shared by the write (L5) and read
 * (L6) routes.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  isStaff,
  type GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import { HUB_NOT_FOUND } from '../../../guilds/hub-hidden.helpers';
import { isBg3Game } from '../bg3-game-match.helpers';

/** A hub as `findHub` resolves it; `hidden` = hidden_at set or not active. */
export interface Bg3HubRow {
  id: number;
  kind: string;
  gameSlug: string | null;
  /** The hub game's IGDB id — BG3 by `BG3_IGDB_ID` when the slug is unknown. */
  gameIgdbId: number | null;
  hidden: boolean;
}

export interface Bg3HubLookup {
  findHub(hubId: number): Promise<Bg3HubRow | null>;
}

/** 404 unless `hub` is a BG3 community hub the actor may see. */
export function refuseNonBg3Hub(
  hub: Bg3HubRow | null,
  actor: GuildActor,
): Bg3HubRow {
  if (
    !hub ||
    hub.kind !== 'game_community' ||
    !isBg3Game(hub.gameSlug, hub.gameIgdbId)
  )
    throw new NotFoundException(HUB_NOT_FOUND);
  if (hub.hidden && !isStaff(actor)) throw new NotFoundException(HUB_NOT_FOUND);
  return hub;
}

/** `refuseNonBg3Hub`, then hub member or staff (else 403). */
export async function assertBg3HubReader(
  hubs: Bg3HubLookup,
  access: Pick<GuildAccessService, 'isMember'>,
  hubId: number,
  actor: GuildActor,
): Promise<Bg3HubRow> {
  const hub = refuseNonBg3Hub(await hubs.findHub(hubId), actor);
  if (isStaff(actor) || (await access.isMember(actor.id, hubId))) return hub;
  throw new ForbiddenException('Hub members only');
}

/**
 * Host powers need the host to still be a hub member: a host kicked from the
 * hub keeps `host_user_id` but loses rename / host change / claim clearing.
 */
export async function isCurrentHost(
  access: Pick<GuildAccessService, 'isMember'>,
  campaign: { guildId: number; hostUserId: number | null },
  actor: GuildActor,
): Promise<boolean> {
  if (campaign.hostUserId !== actor.id) return false;
  return access.isMember(actor.id, campaign.guildId);
}
