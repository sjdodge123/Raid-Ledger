import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  JoinSeriesSchema,
  type JoinSeriesResponseDto,
  type LeaveSeriesResponseDto,
  type SeriesSignupStateDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError } from './controller.helpers';
import { SeriesSignupsService } from './series-signups.service';

/** Series signup routes (ROK-1728, D1): preview, join, leave. */
@Controller('events')
export class EventsSeriesSignupController {
  constructor(private readonly seriesSignups: SeriesSignupsService) {}

  /** Preview / member state of the series from `:id` forward. */
  @Get(':id/series/signup')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async getSeriesSignup(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<SeriesSignupStateDto> {
    try {
      return await this.seriesSignups.getState(id, req.user.id);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /** Joins the series from `:id` forward (201). */
  @Post(':id/series/signup')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async joinSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<JoinSeriesResponseDto> {
    try {
      const dto = JoinSeriesSchema.parse(body ?? {});
      return await this.seriesSignups.join(id, req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /** Leaves the series (200). */
  @Delete(':id/series/signup')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
  async leaveSeries(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<LeaveSeriesResponseDto> {
    try {
      return await this.seriesSignups.leave(id, req.user.id);
    } catch (error) {
      handleValidationError(error);
    }
  }
}
