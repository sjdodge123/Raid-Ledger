import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  CreateEventPlanSchema,
  ConvertEventToPlanSchema,
  EventPlanResponseDto,
  TimeSuggestionsResponse,
  PollResultsResponse,
} from '@raid-ledger/contract';
import { EventPlansService } from './event-plans.service';
import { type ZodType, type ZodTypeDef, ZodError } from 'zod';

import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: {
    id: number;
    role: UserRole;
  };
}

/**
 * Parse data with a Zod schema, converting ZodError to BadRequestException.
 */
function parseOrThrow<TOut, TDef extends ZodTypeDef, TIn>(
  schema: ZodType<TOut, TDef, TIn>,
  data: unknown,
): TOut {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
      });
    }
    throw error;
  }
}

/**
 * Controller for event plan (poll-based scheduling) endpoints (ROK-392).
 */
@Controller('event-plans')
export class EventPlansController {
  constructor(private readonly eventPlansService: EventPlansService) {}

  /**
   * Get smart time suggestions for a game.
   * Public (auth optional) — uses game interest data.
   */
  @Get('time-suggestions')
  async getTimeSuggestions(
    @Query('gameId') gameId?: string,
    @Query('tzOffset') tzOffset?: string,
    @Query('afterDate') afterDate?: string,
  ): Promise<TimeSuggestionsResponse> {
    return this.eventPlansService.getTimeSuggestions(
      gameId ? parseInt(gameId, 10) : undefined,
      tzOffset ? parseInt(tzOffset, 10) : undefined,
      afterDate,
    );
  }

  /**
   * Create a new event plan and post a Discord poll.
   * Requires authentication.
   */
  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventPlanResponseDto> {
    const dto = parseOrThrow(CreateEventPlanSchema, body);
    return this.eventPlansService.create(req.user.id, dto);
  }

  /**
   * List all event plans. All authenticated users can view.
   * Action permissions (cancel, restart) are enforced on individual endpoints.
   */
  @Get('my-plans')
  @UseGuards(AuthGuard('jwt'))
  async listPlans(): Promise<EventPlanResponseDto[]> {
    return this.eventPlansService.findAll();
  }

  /**
   * Convert an existing event into an event plan (poll-based scheduling).
   * Copies event data, posts a Discord poll, and optionally soft-cancels the original.
   * Requires authentication.
   */
  @Post('from-event/:eventId')
  @UseGuards(AuthGuard('jwt'))
  async convertFromEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventPlanResponseDto> {
    const dto = parseOrThrow(ConvertEventToPlanSchema, body);
    return this.eventPlansService.convertFromEvent(
      eventId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  /**
   * Get a single event plan by ID.
   * Requires authentication.
   */
  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventPlanResponseDto> {
    return this.eventPlansService.findOne(id);
  }

  /**
   * Get poll results for an active plan.
   * Requires authentication. Only the creator can access.
   */
  @Get(':id/poll-results')
  @UseGuards(AuthGuard('jwt'))
  async getPollResults(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<PollResultsResponse> {
    return this.eventPlansService.getPollResults(
      id,
      req.user.id,
      req.user.role,
    );
  }

  /**
   * Cancel an active event plan.
   * Requires authentication. Only the creator can cancel.
   */
  @Patch(':id/cancel')
  @UseGuards(AuthGuard('jwt'))
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<EventPlanResponseDto> {
    return this.eventPlansService.cancel(id, req.user.id, req.user.role);
  }

  /**
   * Restart a cancelled or expired plan with a fresh Discord poll.
   * Requires authentication. Only the creator can restart.
   */
  @Patch(':id/restart')
  @UseGuards(AuthGuard('jwt'))
  async restart(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<EventPlanResponseDto> {
    return this.eventPlansService.restart(id, req.user.id, req.user.role);
  }
}
