import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AdminCharacterOwnerResultDto } from '@raid-ledger/contract';
import { AdminGuard } from '../../../../auth/admin.guard';
import type { AuthenticatedRequest } from '../../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { CharacterOwnerAdminService } from './character-owner.admin.service';

/**
 * ROK-2128 (D6, FLAG 5) — admin "Change owner". Site admins only, WoW plugin
 * active; same prefix and guards as the ROK-1756 unlink.
 */
@Controller('admin/plugins/wow/characters')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class CharacterOwnerAdminController {
  constructor(private readonly owners: CharacterOwnerAdminService) {}

  /** PUT /admin/plugins/wow/characters/:id/owner — 200 `AdminCharacterOwnerResult`. */
  @Put(':id/owner')
  reassign(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AdminCharacterOwnerResultDto> {
    return this.owners.reassign(req.user.id, id, body);
  }
}
