/**
 * ROK-1930 L2 — the hub Deaths widget read. D6: no hub → 404, a hub hidden
 * from the viewer → 404, then hub member or staff; a signed-in visitor gets
 * the same 404 body (a hidden widget and a missing hub answer alike).
 * L4a adds the Map tab's server-wide death-pin layer under the same check.
 */
import { Injectable } from '@nestjs/common';
import type {
  ValheimDeathPinsResponse,
  ValheimDeathsResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedUser } from '../../../../auth/types';
import { GuildAccessService } from '../../../../guilds/guild-access.service';
import { ValheimDeathsRepository } from '../valheim-deaths.repository';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { assertHubMemberOrStaff } from './valheim-hub-member.helpers';
import { toDeathsResponse } from './valheim-deaths.mappers';
import { ValheimDeathPinsRepository } from './valheim-deaths-pins.repository';
import { ValheimDeathsPicturesRepository } from './valheim-deaths-pictures.repository';
import { toDeathPinsResponse } from './valheim-deaths-pins.mappers';

@Injectable()
export class ValheimDeathsService {
  constructor(
    private readonly hubs: ValheimArmoryReadRepository,
    private readonly access: GuildAccessService,
    private readonly repo: ValheimDeathsRepository,
    private readonly pins: ValheimDeathPinsRepository,
    private readonly pictures: ValheimDeathsPicturesRepository,
  ) {}

  /** `GET …/servers/:serverId/deaths` (ROK-1941: + visible death pictures). */
  async deaths(
    serverId: number,
    user: AuthenticatedUser,
  ): Promise<ValheimDeathsResponse> {
    await this.assertMemberOrStaff(serverId, user);
    const [counts, pictures] = await Promise.all([
      this.repo.countByPlayer(serverId),
      this.pictures.bucketsFor(serverId),
    ]);
    return toDeathsResponse(counts, pictures);
  }

  /** `GET …/servers/:serverId/deaths/pins?worldUid=` (L4a, same D6 check). */
  async deathPins(
    serverId: number,
    worldUid: string,
    user: AuthenticatedUser,
  ): Promise<ValheimDeathPinsResponse> {
    await this.assertMemberOrStaff(serverId, user);
    const rows = await this.pins.mapsOnWorld(serverId, worldUid);
    return toDeathPinsResponse(worldUid, rows);
  }

  /** D6 — see `assertHubMemberOrStaff`. */
  private assertMemberOrStaff(
    serverId: number,
    user: AuthenticatedUser,
  ): Promise<void> {
    return assertHubMemberOrStaff(this.hubs, this.access, serverId, user);
  }
}
