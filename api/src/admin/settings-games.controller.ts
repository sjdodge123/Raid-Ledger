import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  NotFoundException,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { IgdbService } from '../igdb/igdb.service';
import type {
  IgdbSyncStatusDto,
  AdminGameListResponseDto,
} from '@raid-ledger/contract';
import { queryGameList } from './settings-games.helpers';
import { triggerIgdbSync } from './settings-igdb-sync.helpers';
import { resetGameEnrichment } from './settings-games-enrichment.helpers';

/**
 * Admin Games & IGDB Sync Controller.
 * Extracted from AdminSettingsController for file size compliance.
 */
@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminGamesController {
  private readonly logger = new Logger(AdminGamesController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly igdbService: IgdbService,
  ) {}

  @Get('igdb/sync-status')
  async getIgdbSyncStatus(): Promise<IgdbSyncStatusDto> {
    return this.igdbService.getSyncStatus();
  }

  @Post('igdb/sync')
  @HttpCode(HttpStatus.OK)
  async triggerIgdbSync() {
    return triggerIgdbSync(this.igdbService, this.logger);
  }

  @Get('games')
  async listGames(
    @Query('search') search?: string,
    @Query('showHidden') showHidden?: string,
    @Query('enrichmentStatus') enrichmentStatus?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ): Promise<AdminGameListResponseDto> {
    return queryGameList(this.igdbService.database, {
      search,
      showHidden,
      enrichmentStatus,
      page,
      limit,
    });
  }

  /** Reset IGDB enrichment status for a game (admin only). */
  @Post('games/:id/reset-enrichment')
  @HttpCode(HttpStatus.OK)
  async resetEnrichment(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean }> {
    const found = await resetGameEnrichment(this.igdbService.database, id);
    if (!found) throw new NotFoundException('Game not found');
    return { success: true };
  }

  @Post('games/:id/ban')
  @HttpCode(HttpStatus.OK)
  async banGame(@Param('id', ParseIntPipe) id: number) {
    const result = await this.igdbService.banGame(id);
    if (!result.success) throw new BadRequestException(result.message);
    return { success: result.success, message: result.message };
  }

  @Post('games/:id/unban')
  @HttpCode(HttpStatus.OK)
  async unbanGame(@Param('id', ParseIntPipe) id: number) {
    const result = await this.igdbService.unbanGame(id);
    if (!result.success) throw new BadRequestException(result.message);
    return { success: result.success, message: result.message };
  }

  @Post('games/:id/hide')
  @HttpCode(HttpStatus.OK)
  async hideGame(@Param('id', ParseIntPipe) id: number) {
    const result = await this.igdbService.hideGame(id);
    if (!result.success) throw new BadRequestException(result.message);
    return { success: result.success, message: result.message };
  }

  @Post('games/:id/unhide')
  @HttpCode(HttpStatus.OK)
  async unhideGame(@Param('id', ParseIntPipe) id: number) {
    const result = await this.igdbService.unhideGame(id);
    if (!result.success) throw new BadRequestException(result.message);
    return { success: result.success, message: result.message };
  }

  @Get('igdb/adult-filter')
  async getAdultFilter(): Promise<{ enabled: boolean }> {
    return { enabled: await this.igdbService.isAdultFilterEnabled() };
  }

  @Put('igdb/adult-filter')
  @HttpCode(HttpStatus.OK)
  async setAdultFilter(
    @Body() body: { enabled: boolean },
  ): Promise<{ success: boolean; message: string; hiddenCount?: number }> {
    const enabled = body.enabled === true;
    await this.settingsService.set(
      SETTING_KEYS.IGDB_FILTER_ADULT,
      String(enabled),
    );
    let hiddenCount = 0;
    if (enabled) hiddenCount = await this.igdbService.hideAdultGames();
    this.logger.log(
      `Adult content filter ${enabled ? 'enabled' : 'disabled'} via admin UI${hiddenCount > 0 ? ` (${hiddenCount} games auto-hidden)` : ''}`,
    );
    return {
      success: true,
      hiddenCount: enabled ? hiddenCount : undefined,
      message: enabled
        ? `Adult content filter enabled.${hiddenCount > 0 ? ` ${hiddenCount} games with adult themes were hidden.` : ''}`
        : 'Adult content filter disabled.',
    };
  }
}
