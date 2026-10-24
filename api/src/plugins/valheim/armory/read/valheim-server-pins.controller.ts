import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ValheimServerPinsQuerySchema,
  type ValheimServerPinsQuery,
  type ValheimServerPinsResponse,
} from '@raid-ledger/contract';
import type { AuthenticatedExpressRequest } from '../../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { armoryIdPipe } from '../valheim-armory-id.pipe';
import { ValheimServerPinsService } from './valheim-server-pins.service';

/** The query param a failed parse names in its 400 message. */
const QUERY_KEYS = ['worldUid', 'players', 'types'] as const;

/** Parses the query; 400 `Invalid <param>` naming the first bad one. */
export function parseServerPinsQuery(query: unknown): ValheimServerPinsQuery {
  const parsed = ValheimServerPinsQuerySchema.safeParse(query);
  if (parsed.success) return parsed.data;
  const key = parsed.error.issues[0]?.path[0];
  const named = QUERY_KEYS.find((k) => k === key) ?? 'query';
  throw new BadRequestException(`Invalid ${named}`);
}

/**
 * ROK-1943 — the Map tab's cross-player pin layer. Hub members and staff
 * only (D6, same audience as `deaths/pins`); everyone else gets the hub 404.
 */
@Controller()
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
export class ValheimServerPinsController {
  constructor(private readonly serverPins: ValheimServerPinsService) {}

  /** GET — own pins of every (or the named) character on one world. */
  @Get('plugins/valheim/armory/servers/:serverId/pins')
  @Header('Cache-Control', 'private, no-store')
  pins(
    @Param('serverId', armoryIdPipe) serverId: number,
    @Query() query: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<ValheimServerPinsResponse> {
    const parsed = parseServerPinsQuery(query);
    return this.serverPins.pins(serverId, parsed, req.user);
  }
}
