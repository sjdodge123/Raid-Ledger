/**
 * Admin Demo Data Settings Controller (split out of AdminSettingsController
 * for ROK-1700).
 *
 * Demo Data is NAS-only: NasOnlyGuard is listed FIRST so under
 * RL_FLAVOUR=cloud every route is a 404 — even for an unauthenticated probe,
 * which would otherwise get the JWT guard's 401. Route paths are unchanged:
 * `GET status`, `POST install`, `POST clear` under `/admin/settings/demo`.
 */
import {
  Controller,
  Get,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  DemoDataStatusDto,
  DemoDataResultDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { NasOnlyGuard } from '../common/flavour/nas-only.guard';
import { DemoDataService } from './demo-data.service';

@Controller('admin/settings/demo')
@UseGuards(NasOnlyGuard, AuthGuard('jwt'), AdminGuard)
export class DemoDataSettingsController {
  constructor(private readonly demoDataService: DemoDataService) {}

  /** GET /admin/settings/demo/status — demo-mode flag + demo row counts. */
  @Get('status')
  async getDemoStatus(): Promise<DemoDataStatusDto> {
    return this.demoDataService.getStatus();
  }

  /** POST /admin/settings/demo/install — seed the demo data set. */
  @Post('install')
  @HttpCode(HttpStatus.OK)
  async installDemoData(): Promise<DemoDataResultDto> {
    return this.demoDataService.installDemoData();
  }

  /** POST /admin/settings/demo/clear — remove the demo data set. */
  @Post('clear')
  @HttpCode(HttpStatus.OK)
  async clearDemoData(): Promise<DemoDataResultDto> {
    return this.demoDataService.clearDemoData();
  }
}
