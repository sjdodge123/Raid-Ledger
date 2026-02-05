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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import {
  CreateEventSchema,
  UpdateEventSchema,
  EventListQuerySchema,
  CreateSignupSchema,
  ConfirmSignupSchema,
  EventResponseDto,
  EventListResponseDto,
  SignupResponseDto,
  EventRosterDto,
  RosterAvailabilityResponse,
  RosterAvailabilityQuerySchema,
  UpdateRosterSchema,
  RosterWithAssignments,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

interface AuthenticatedRequest {
  user: {
    id: number;
    isAdmin: boolean;
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
      const event = await this.eventsService.create(req.user.id, dto);

      // AC-5: Auto-signup creator when creating event
      await this.signupsService.signup(event.id, req.user.id);

      return event;
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get paginated list of events.
   * Public endpoint.
   */
  @Get()
  async findAll(
    @Query() query: Record<string, string>,
  ): Promise<EventListResponseDto> {
    try {
      const dto = EventListQuerySchema.parse(query);
      return this.eventsService.findAll(dto);
    } catch (error) {
      handleValidationError(error);
    }
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
      return this.eventsService.update(id, req.user.id, req.user.isAdmin, dto);
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
    await this.eventsService.delete(id, req.user.id, req.user.isAdmin);
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
        req.user.isAdmin,
        dto,
      );
    } catch (error) {
      handleValidationError(error);
    }
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
}
