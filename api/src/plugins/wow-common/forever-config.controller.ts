import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WowForeverConfigSchema } from '@raid-ledger/contract';
import type {
  BlizzardCapabilitiesDto,
  WowForeverConfigResponseDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import {
  RequirePlugin,
  PluginActiveGuard,
} from '../plugin-host/plugin-active.guard';
import { ForeverConfigService } from './forever-config.service';

/**
 * WoW: Forever runtime config routes (ROK-1717). All plugin-gated like
 * `/blizzard/realms`. The capability flag is public (the Add Character flow is
 * user-facing); the config read/write is admin-only.
 */
@Controller()
@RequirePlugin('blizzard')
@UseGuards(PluginActiveGuard)
export class ForeverConfigController {
  constructor(private readonly forever: ForeverConfigService) {}

  /** GET /blizzard/capabilities — which variants may use Armory import. */
  @Get('blizzard/capabilities')
  getCapabilities(): Promise<BlizzardCapabilitiesDto> {
    return this.forever.getCapabilities();
  }

  /** GET /admin/plugins/blizzard/forever — current Forever config. */
  @Get('admin/plugins/blizzard/forever')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  getConfig(): Promise<WowForeverConfigResponseDto> {
    return this.forever.getConfig();
  }

  /** PUT /admin/plugins/blizzard/forever — save prefix + Armory flag (400 on a bad prefix). */
  @Put('admin/plugins/blizzard/forever')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  updateConfig(@Body() body: unknown): Promise<WowForeverConfigResponseDto> {
    const parsed = WowForeverConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    return this.forever.updateConfig(parsed.data);
  }
}
