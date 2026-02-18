import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { PugsService } from './pugs.service';
import {
  CreateEventSchema,
  UpdateEventSchema,
  EventListQuerySchema,
  CreateSignupSchema,
  ConfirmSignupSchema,
  UpdateSignupStatusSchema,
  RescheduleEventSchema,
  CreatePugSlotSchema,
  UpdatePugSlotSchema,
  EventResponseDto,
  EventListResponseDto,
  DashboardResponseDto,
  SignupResponseDto,
  EventRosterDto,
  RosterAvailabilityResponse,
  RosterAvailabilityQuerySchema,
  UpdateRosterSchema,
  RosterWithAssignments,
  AggregateGameTimeResponse,
  PugSlotResponseDto,
  PugSlotListResponseDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

import type { UserRole } from '@raid-ledger/contract';

/** Helper: check if user has operator-or-above role */
function isOperatorOrAdmin(role: UserRole): boolean {
  return role === 'operator' || role === 'admin';
}

interface AuthenticatedRequest {
  user: {
    id: number;
    role: UserRole;
  };
}

/**
 * Handle Zod validation errors by converting to BadRequestException.
 * Rethrows non-Zod errors.
 */
function handleValidationError(error: unknown): never {
  // Use name check as instanceof may fail with multiple zod instances
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
 * Controller for event CRUD operations and signups.
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly signupsService: SignupsService,
    private readonly pugsService: PugsService,
  ) {}

  /**
   * Create a new event.
   * Requires authentication. Auto-signs up creator (AC-5).
   */
  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = CreateEventSchema.parse(body);
      const result = await this.eventsService.create(req.user.id, dto);

      // AC-5: Auto-signup creator when creating event (all instances for recurring)
      const eventIds = result.allEventIds ?? [result.id];
      await Promise.all(
        eventIds.map((id) => this.signupsService.signup(id, req.user.id)),
      );

      // Strip internal allEventIds before returning
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { allEventIds, ...event } = result;
      return event;
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get paginated list of events.
   * Public endpoint; optional JWT resolves "me" in creatorId/signedUpAs filters (ROK-213).
   */
  @Get()
  @UseGuards(OptionalJwtGuard)
  async findAll(
    @Query() query: Record<string, string>,
    @Request() req: { user?: { id: number; role: UserRole } },
  ): Promise<EventListResponseDto> {
    try {
      const dto = EventListQuerySchema.parse(query);
      return this.eventsService.findAll(dto, req.user?.id);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get organizer dashboard with stats (ROK-213).
   * Requires authentication. Admins see all events, others see only their own.
   * MUST be registered before :id to avoid route conflict.
   */
  @Get('my-dashboard')
  @UseGuards(AuthGuard('jwt'))
  async getMyDashboard(
    @Request() req: AuthenticatedRequest,
  ): Promise<DashboardResponseDto> {
    return this.eventsService.getMyDashboard(
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
  }

  /**
   * Get a single event by ID.
   * Public endpoint.
   */
  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<EventResponseDto> {
    return this.eventsService.findOne(id);
  }

  /**
   * Update an event.
   * Requires authentication. Only creator or admin can update.
   */
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = UpdateEventSchema.parse(body);
      return this.eventsService.update(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get aggregate game time for signed-up users (ROK-223).
   * Returns heatmap data showing how many players are available at each day/hour.
   * Public endpoint.
   */
  @Get(':id/aggregate-game-time')
  async getAggregateGameTime(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AggregateGameTimeResponse> {
    return this.eventsService.getAggregateGameTime(id);
  }

  /**
   * Reschedule an event (ROK-223).
   * Requires authentication. Only creator or admin can reschedule.
   * Notifies all signed-up users.
   */
  @Patch(':id/reschedule')
  @UseGuards(AuthGuard('jwt'))
  async reschedule(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<EventResponseDto> {
    try {
      const dto = RescheduleEventSchema.parse(body);
      return this.eventsService.reschedule(
        id,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Delete an event.
   * Requires authentication. Only creator or admin can delete.
   */
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    await this.eventsService.delete(
      id,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
    return { message: 'Event deleted successfully' };
  }

  // ============================================================
  // Signup Endpoints (FR-006)
  // ============================================================

  /**
   * Sign up for an event.
   * Requires authentication. Idempotent - returns existing signup if already signed up.
   */
  @Post(':id/signup')
  @UseGuards(AuthGuard('jwt'))
  async signup(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<SignupResponseDto> {
    try {
      const dto =
        body && typeof body === 'object' && Object.keys(body).length > 0
          ? CreateSignupSchema.parse(body)
          : undefined;
      return this.signupsService.signup(eventId, req.user.id, dto);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Cancel signup for an event.
   * Requires authentication.
   */
  @Delete(':id/signup')
  @UseGuards(AuthGuard('jwt'))
  async cancelSignup(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    await this.signupsService.cancel(eventId, req.user.id);
    return { message: 'Signup canceled successfully' };
  }

  /**
   * Get event roster (list of signups).
   * Public endpoint.
   */
  @Get(':id/roster')
  async getRoster(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<EventRosterDto> {
    return this.signupsService.getRoster(eventId);
  }

  /**
   * Update roster assignments (ROK-114 AC-5).
   * Requires authentication. Only event creator or admin can update.
   */
  @Patch(':id/roster')
  @UseGuards(AuthGuard('jwt'))
  async updateRoster(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<RosterWithAssignments> {
    try {
      const dto = UpdateRosterSchema.parse(body);
      return this.signupsService.updateRoster(
        eventId,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Self-unassign from roster slot (ROK-226).
   * Removes the current user's roster assignment but keeps their signup.
   * Dispatches slot_vacated notification to organizer.
   */
  @Delete(':id/roster/me')
  @UseGuards(AuthGuard('jwt'))
  async selfUnassign(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<RosterWithAssignments> {
    return this.signupsService.selfUnassign(eventId, req.user.id);
  }

  /**
   * Get roster with assignment data (ROK-114 AC-6).
   * Returns pool and assignments for RosterBuilder component.
   * Public endpoint.
   */
  @Get(':id/roster/assignments')
  async getRosterWithAssignments(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<RosterWithAssignments> {
    return this.signupsService.getRosterWithAssignments(eventId);
  }

  /**
   * Get roster availability for heatmap visualization (ROK-113).
   * Returns availability data for all signed-up users within the event timeframe.
   * Public endpoint.
   */
  @Get(':id/roster/availability')
  async getRosterAvailability(
    @Param('id', ParseIntPipe) eventId: number,
    @Query() query: Record<string, string>,
  ): Promise<RosterAvailabilityResponse> {
    try {
      const dto = RosterAvailabilityQuerySchema.parse(query);
      return this.eventsService.getRosterAvailability(
        eventId,
        dto.from,
        dto.to,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Confirm signup with character selection (ROK-131 AC-2).
   * Requires authentication. User must own the signup.
   */
  @Patch(':id/signups/:signupId/confirm')
  @UseGuards(AuthGuard('jwt'))
  async confirmSignup(
    @Param('id', ParseIntPipe) eventId: number,
    @Param('signupId', ParseIntPipe) signupId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<SignupResponseDto> {
    try {
      const dto = ConfirmSignupSchema.parse(body);
      return this.signupsService.confirmSignup(
        eventId,
        signupId,
        req.user.id,
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Update signup status (ROK-137).
   * Allows changing between signed_up, tentative, declined.
   * Requires authentication.
   */
  @Patch(':id/signup/status')
  @UseGuards(AuthGuard('jwt'))
  async updateSignupStatus(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<SignupResponseDto> {
    try {
      const dto = UpdateSignupStatusSchema.parse(body);
      return this.signupsService.updateStatus(
        eventId,
        { userId: req.user.id },
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  // ============================================================
  // PUG Slot Endpoints (ROK-262)
  // ============================================================

  /**
   * Add a PUG slot to an event.
   * Requires authentication. Only event creator or admin/operator.
   */
  @Post(':id/pugs')
  @UseGuards(AuthGuard('jwt'))
  async createPug(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<PugSlotResponseDto> {
    try {
      const dto = CreatePugSlotSchema.parse(body);
      return this.pugsService.create(
        eventId,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * List PUG slots for an event.
   * Public endpoint.
   */
  @Get(':id/pugs')
  async listPugs(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<PugSlotListResponseDto> {
    return this.pugsService.findAll(eventId);
  }

  /**
   * Update a PUG slot.
   * Requires authentication. Only event creator or admin/operator.
   */
  @Patch(':id/pugs/:pugId')
  @UseGuards(AuthGuard('jwt'))
  async updatePug(
    @Param('id', ParseIntPipe) eventId: number,
    @Param('pugId', ParseUUIDPipe) pugId: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<PugSlotResponseDto> {
    try {
      const dto = UpdatePugSlotSchema.parse(body);
      return this.pugsService.update(
        eventId,
        pugId,
        req.user.id,
        isOperatorOrAdmin(req.user.role),
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Remove a PUG slot.
   * Requires authentication. Only event creator or admin/operator.
   */
  @Delete(':id/pugs/:pugId')
  @UseGuards(AuthGuard('jwt'))
  async deletePug(
    @Param('id', ParseIntPipe) eventId: number,
    @Param('pugId', ParseUUIDPipe) pugId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    await this.pugsService.remove(
      eventId,
      pugId,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
    return { message: 'PUG slot removed successfully' };
  }
}
