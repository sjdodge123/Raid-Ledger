/**
 * ROK-1930 D6, shared by ROK-1943 — the audience for server-wide Valheim
 * layers (Deaths widget, death pins, cross-player pins): no hub → 404, a hub
 * hidden from the viewer → 404, then hub member or staff. A signed-in
 * visitor gets the same 404 body (a hidden layer and a missing hub answer
 * alike).
 */
import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../auth/types';
import {
  type GuildAccessService,
  isStaff,
} from '../../../../guilds/guild-access.service';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import type { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { refuseHiddenHub } from './valheim-armory-hub-visibility.helpers';

/** `assertServerHubVisible` (A4 + ROK-1856), then D6 membership. */
export async function assertHubMemberOrStaff(
  hubs: ValheimArmoryReadRepository,
  access: GuildAccessService,
  serverId: number,
  user: AuthenticatedUser,
): Promise<void> {
  const hub = await hubs.findServerHub(serverId);
  if (!hub) throw new NotFoundException(HUB_NOT_FOUND);
  refuseHiddenHub(hub, user);
  if (isStaff(user)) return;
  if (await access.isMember(user.id, hub.id)) return;
  throw new NotFoundException(HUB_NOT_FOUND);
}
