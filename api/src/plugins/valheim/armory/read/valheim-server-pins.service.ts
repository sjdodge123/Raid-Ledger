/**
 * ROK-1943 — the Map tab's cross-player pin layer, under the deaths layer's
 * audience (D6: hub member or staff; anyone else gets the hub 404).
 */
import { Injectable } from '@nestjs/common';
import type {
  ValheimServerPinsQuery,
  ValheimServerPinsResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../../auth/types';
import { GuildAccessService } from '../../../../guilds/guild-access.service';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { assertHubMemberOrStaff } from './valheim-hub-member.helpers';
import { ValheimServerPinsRepository } from './valheim-server-pins.repository';
import { toServerPinsResponse } from './valheim-server-pins.mappers';

@Injectable()
export class ValheimServerPinsService {
  constructor(
    private readonly hubs: ValheimArmoryReadRepository,
    private readonly access: GuildAccessService,
    private readonly repo: ValheimServerPinsRepository,
  ) {}

  /** `GET …/servers/:serverId/pins?worldUid=&players=&types=`. */
  async pins(
    serverId: number,
    query: ValheimServerPinsQuery,
    user: AuthenticatedUser,
  ): Promise<ValheimServerPinsResponse> {
    await assertHubMemberOrStaff(this.hubs, this.access, serverId, user);
    const { worldUid, players, types } = query;
    const rows = await this.repo.mapsOnWorld(serverId, worldUid, players);
    return toServerPinsResponse(worldUid, rows, types);
  }
}
