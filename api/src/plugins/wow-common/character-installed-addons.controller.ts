import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { CharacterInstalledAddonsResponse } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from './manifest';
import { CharacterInstalledAddonsService } from './character-installed-addons.service';

/**
 * ROK-2147 §5 — the character page's installed-addon list. Unlike the
 * public quest section this is JWT-only; who may see it is decided in the
 * service (owner, or an officer of the character's guild — D6).
 */
@Controller('plugins/wow/characters')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class CharacterInstalledAddonsController {
  constructor(private readonly installed: CharacterInstalledAddonsService) {}

  /** GET /plugins/wow/characters/:id/installed-addons → `{ visible, installed }`. */
  @Get(':id/installed-addons')
  @UseGuards(AuthGuard('jwt'))
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CharacterInstalledAddonsResponse> {
    return this.installed.getForCharacter(req.user, id);
  }
}
