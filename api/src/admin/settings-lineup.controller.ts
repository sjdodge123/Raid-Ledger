/**
 * Admin Lineup Settings Controller (ROK-946).
 * Endpoints for managing default lineup phase durations.
 */
import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { LineupDefaultsDto } from './settings-lineup.dto';
import { getLineupDurationDefaults } from '../lineups/queue/lineup-phase-settings.helpers';

@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class LineupSettingsController {
  private readonly logger = new Logger(LineupSettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get('lineup')
  async getLineupDefaults() {
    const defaults = await getLineupDurationDefaults(this.settingsService);
    return {
      buildingDurationHours: defaults.building,
      votingDurationHours: defaults.voting,
      decidedDurationHours: defaults.decided,
    };
  }

  @Put('lineup')
  @HttpCode(HttpStatus.OK)
  async updateLineupDefaults(
    @Body() body: LineupDefaultsDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.saveLineupDefaults(body);
    this.logger.log('Lineup phase duration defaults updated via admin UI');
    return { success: true, message: 'Lineup phase durations updated.' };
  }

  /** Persist individual duration settings. */
  private async saveLineupDefaults(body: LineupDefaultsDto): Promise<void> {
    const ops: Promise<void>[] = [];
    if (body.buildingDurationHours != null) {
      ops.push(
        this.settingsService.set(
          SETTING_KEYS.LINEUP_DEFAULT_BUILDING_HOURS,
          String(body.buildingDurationHours),
        ),
      );
    }
    if (body.votingDurationHours != null) {
      ops.push(
        this.settingsService.set(
          SETTING_KEYS.LINEUP_DEFAULT_VOTING_HOURS,
          String(body.votingDurationHours),
        ),
      );
    }
    if (body.decidedDurationHours != null) {
      ops.push(
        this.settingsService.set(
          SETTING_KEYS.LINEUP_DEFAULT_DECIDED_HOURS,
          String(body.decidedDurationHours),
        ),
      );
    }
    await Promise.all(ops);
  }
}
