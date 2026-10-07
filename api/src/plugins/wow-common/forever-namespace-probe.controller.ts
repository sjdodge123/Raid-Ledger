import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ForeverProbeConfigSchema } from '@raid-ledger/contract';
import type {
  ForeverProbeResultDto,
  ForeverProbeStateDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import {
  RequirePlugin,
  PluginActiveGuard,
} from '../plugin-host/plugin-active.guard';
import { ForeverNamespaceProbeService } from './forever-namespace-probe.service';

/**
 * WoW: Forever namespace discovery probe admin routes (ROK-1716). All three
 * are admin-only and plugin-gated; the probe only reports (never flips 1717's
 * Forever settings).
 */
@Controller('admin/plugins/blizzard/forever-probe')
@RequirePlugin('blizzard')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
export class ForeverNamespaceProbeController {
  constructor(private readonly probe: ForeverNamespaceProbeService) {}

  /** GET — last stored result (null = never ran) plus the probe config. */
  @Get()
  getState(): Promise<ForeverProbeStateDto> {
    return this.probe.getState();
  }

  /** POST /run — run the probe now (joins a run in progress) and return it. */
  @Post('run')
  @HttpCode(200)
  run(): Promise<ForeverProbeResultDto> {
    return this.probe.run();
  }

  /** PUT /config — save extra candidates + optional character path (400 on bad input). */
  @Put('config')
  updateConfig(@Body() body: unknown): Promise<ForeverProbeStateDto> {
    const parsed = ForeverProbeConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    return this.probe.updateConfig(parsed.data);
  }
}
