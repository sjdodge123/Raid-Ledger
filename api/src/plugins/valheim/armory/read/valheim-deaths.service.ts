/**
 * ROK-1930 L2 — the hub Deaths widget read. D6: no hub → 404, a hub hidden
 * from the viewer → 404, then hub member or staff; a signed-in visitor gets
 * the same 404 body (a hidden widget and a missing hub answer alike).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { ValheimDeathsResponse } from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../../auth/types';
import {
  GuildAccessService,
  isStaff,
} from '../../../../guilds/guild-access.service';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import { ValheimDeathsRepository } from '../valheim-deaths.repository';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { refuseHiddenHub } from './valheim-armory-hub-visibility.helpers';
import { toDeathsResponse } from './valheim-deaths.mappers';

@Injectable()
export class ValheimDeathsService {
  constructor(
    private readonly hubs: ValheimArmoryReadRepository,
    private readonly access: GuildAccessService,
    private readonly repo: ValheimDeathsRepository,
  ) {}

  /** `GET …/servers/:serverId/deaths`. */
  async deaths(
    serverId: number,
    user: AuthenticatedUser,
  ): Promise<ValheimDeathsResponse> {
    await this.assertMemberOrStaff(serverId, user);
    return toDeathsResponse(await this.repo.countByPlayer(serverId));
  }

  /** `assertServerHubVisible` (A4 + ROK-1856), then D6 membership. */
  private async assertMemberOrStaff(
    serverId: number,
    user: AuthenticatedUser,
  ): Promise<void> {
    const hub = await this.hubs.findServerHub(serverId);
    if (!hub) throw new NotFoundException(HUB_NOT_FOUND);
    refuseHiddenHub(hub, user);
    if (isStaff(user)) return;
    if (await this.access.isMember(user.id, hub.id)) return;
    throw new NotFoundException(HUB_NOT_FOUND);
  }
}
