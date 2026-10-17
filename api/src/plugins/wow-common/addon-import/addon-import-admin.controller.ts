import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../../../auth/admin.guard';
import type { AuthenticatedRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { AddonCharacterUnlinkService } from './addon-import.unlink';
import type { AddonCharacterUnlinkResult } from './addon-import.unlink.types';

/**
 * ROK-1756 — admin recovery for a LedgerLink GUID squat. Admin-only, WoW
 * plugin (`blizzard`) must be active. See `addon-import.unlink.ts`.
 */
@Controller('admin/plugins/wow/characters')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class AddonImportAdminController {
  constructor(private readonly unlinkService: AddonCharacterUnlinkService) {}

  /** POST /admin/plugins/wow/characters/:id/unlink */
  @Post(':id/unlink')
  @HttpCode(200)
  unlink(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddonCharacterUnlinkResult> {
    return this.unlinkService.unlink(req.user.id, id);
  }
}
