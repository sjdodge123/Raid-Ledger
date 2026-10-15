import {
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  CancelSeriesSchema,
  SeriesScopeSchema,
  UpdateSeriesSchema,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';
import { EventSeriesService } from './event-series.service';
import { EventGuildTagService } from './event-guild-tag.service';

/**
 * Recurring-series edit/delete/cancel routes (ROK-429), split out of
 * EventsController (ROK-1787) to keep it under the file-size cap.
 */
@Controller('events')
export class EventsSeriesController {
  constructor(
    private readonly seriesService: EventSeriesService,
    private readonly guildTag: EventGuildTagService,
  ) {}

  @Patch(':id/series')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async updateSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ message: string }> {
    try {
      const dto = UpdateSeriesSchema.parse(body);
      await this.guildTag.assertUpdate(req.user, id, dto.data);
      await this.seriesService.update(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto.scope,
        dto.data,
      );
      return { message: 'Series updated successfully' };
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Delete(':id/series')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async deleteSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Query('scope') scope: string,
  ): Promise<{ message: string }> {
    try {
      const parsed = SeriesScopeSchema.parse(scope);
      await this.seriesService.delete(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        parsed,
      );
      return { message: 'Series deleted successfully' };
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Patch(':id/series/cancel')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async cancelSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ message: string }> {
    try {
      const dto = CancelSeriesSchema.parse(body);
      await this.seriesService.cancel(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto.scope,
        dto,
      );
      return { message: 'Series cancelled successfully' };
    } catch (error) {
      handleValidationError(error);
    }
  }
}
