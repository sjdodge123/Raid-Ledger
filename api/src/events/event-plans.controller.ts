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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  CreateEventPlanSchema,
  EventPlanResponseDto,
  TimeSuggestionsResponse,
  PollResultsResponse,
} from '@raid-ledger/contract';
import { EventPlansService } from './event-plans.service';
import { ZodError } from 'zod';

import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: {
    id: number;
    role: UserRole;
  };
}

/**
 * Handle Zod validation errors by converting to BadRequestException.
 */
function handleValidationError(error: unknown): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const zodError = error as ZodError;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  throw error;
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
    try {
      const dto = CreateEventPlanSchema.parse(body);
      return this.eventPlansService.create(req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * List the current user's event plans.
   * Requires authentication.
   */
  @Get('my-plans')
  @UseGuards(AuthGuard('jwt'))
  async myPlans(
    @Request() req: AuthenticatedRequest,
  ): Promise<EventPlanResponseDto[]> {
    return this.eventPlansService.findByCreator(req.user.id);
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
    return this.eventPlansService.getPollResults(id, req.user.id);
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
    return this.eventPlansService.cancel(id, req.user.id);
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
    return this.eventPlansService.restart(id, req.user.id);
  }
}
