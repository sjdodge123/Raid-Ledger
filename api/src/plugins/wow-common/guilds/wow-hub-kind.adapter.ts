import { Injectable } from '@nestjs/common';
import type { GuildKind, LadderRole } from '@raid-ledger/contract';
import type { HubKindAdapter } from '../../plugin-host/extension-points';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import { WOW_COMMON_MANIFEST } from '../manifest';

/**
 * ROK-1830: WoW registers itself as the `wow_guild` hub kind. Membership is
 * a live linked roster row (D3); the ladder is today's rank/delegation rule.
 * S2a delegates to `GuildAccessService`; S2b lifts the WoW-only queries here.
 */
@Injectable()
export class WowHubKindAdapter implements HubKindAdapter {
  readonly kind: GuildKind = 'wow_guild';
  readonly pluginSlug: string = WOW_COMMON_MANIFEST.id;

  constructor(private readonly access: GuildAccessService) {}

  isMember(userId: number, guildId: number): Promise<boolean> {
    return this.access.isMember(userId, guildId);
  }

  resolveLadder(actor: GuildActor, guildId: number): Promise<LadderRole> {
    return this.access.resolveLadder(actor, guildId);
  }
}
