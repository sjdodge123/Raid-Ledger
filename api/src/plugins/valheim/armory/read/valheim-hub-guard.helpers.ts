/**
 * ROK-1853 A4 + ROK-1856 — the hub check every hub-scoped Armory read runs
 * before touching data: no hub for the server → 404, a hub hidden from this
 * viewer → 404 (same body). Shared by the Materials and Recipes services.
 */
import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../auth/types';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import { refuseHiddenHub } from './valheim-armory-hub-visibility.helpers';
import type { ValheimArmoryReadRepository } from './valheim-armory-read.repository';

/** The hub must exist and be visible to `user` (call before any read). */
export async function assertServerHubVisible(
  hubs: Pick<ValheimArmoryReadRepository, 'findServerHub'>,
  serverId: number,
  user: AuthenticatedUser,
): Promise<void> {
  const hub = await hubs.findServerHub(serverId);
  if (!hub) throw new NotFoundException(HUB_NOT_FOUND);
  refuseHiddenHub(hub, { id: user.id, role: user.role });
}
