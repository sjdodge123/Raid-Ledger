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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SignupsService } from './signups.service';
import { EventsService } from './events.service';
import {
  CreateSignupSchema,
  ConfirmSignupSchema,
  UpdateSignupStatusSchema,
  UpdateRosterSchema,
  RosterAvailabilityQuerySchema,
  SignupResponseDto,
  EventRosterDto,
  RosterAvailabilityResponse,
  RosterWithAssignments,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { handleValidationError, isOperatorOrAdmin } from './controller.helpers';

@Controller('events')
export class EventsSignupsController {
  constructor(
    private readonly signupsService: SignupsService,
    private readonly eventsService: EventsService,
  ) {}

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

  @Delete(':id/signup')
  @UseGuards(AuthGuard('jwt'))
  async cancelSignup(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    await this.signupsService.cancel(eventId, req.user.id);
    return { message: 'Signup canceled successfully' };
  }

  @Get(':id/roster')
  async getRoster(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<EventRosterDto> {
    return this.signupsService.getRoster(eventId);
  }

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

  @Delete(':id/roster/me')
  @UseGuards(AuthGuard('jwt'))
  async selfUnassign(
    @Param('id', ParseIntPipe) eventId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<RosterWithAssignments> {
    return this.signupsService.selfUnassign(eventId, req.user.id);
  }

  @Get(':id/roster/assignments')
  async getRosterWithAssignments(
    @Param('id', ParseIntPipe) eventId: number,
  ): Promise<RosterWithAssignments> {
    return this.signupsService.getRosterWithAssignments(eventId);
  }

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

  @Delete(':id/signups/:signupId')
  @UseGuards(AuthGuard('jwt'))
  async adminRemoveSignup(
    @Param('id', ParseIntPipe) eventId: number,
    @Param('signupId', ParseIntPipe) signupId: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    await this.signupsService.adminRemoveSignup(
      eventId,
      signupId,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
    return { message: 'User removed from event successfully' };
  }
}
