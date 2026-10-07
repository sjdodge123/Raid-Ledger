import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  AddonImportNewResultDto,
  AddonImportResultDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { AddonImportCreateService } from './addon-import-create.service';
import { AddonImportService } from './addon-import.service';

/**
 * ROK-1724 — `POST /plugins/wow/characters/:id/addon-import`. Owner-only,
 * WoW plugin (`blizzard`) must be active. The body is validated in the
 * service, NOT by a `ZodValidationPipe`: the request schema caps
 * `importString`, and an oversized paste must answer 413 `TOO_LARGE`, not
 * the pipe's 400.
 * ROK-1738 — `POST /plugins/wow/characters/addon-import` (no id): the
 * export's GUID picks the target — update the importer's own character, or
 * create the Forever character — same guards, limit and audit.
 */
@Controller('plugins/wow/characters')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class AddonImportController {
  constructor(
    private readonly service: AddonImportService,
    private readonly createService: AddonImportCreateService,
  ) {}

  @Post('addon-import')
  @HttpCode(200)
  addonImportNew(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<AddonImportNewResultDto> {
    return this.createService.importNew(req.user.id, body);
  }

  @Post(':id/addon-import')
  @HttpCode(200)
  addonImport(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AddonImportResultDto> {
    return this.service.importString(req.user.id, id, body);
  }
}
