/**
 * Controller for standalone scheduling polls (ROK-977).
 * POST /scheduling-polls — any authenticated user can create.
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import {
  CreateSchedulingPollSchema,
  type CreateSchedulingPollDto,
  type SchedulingPollResponseDto,
} from '@raid-ledger/contract';
import {
  StandalonePollService,
  type CreatePollInput,
} from './standalone-poll.service';
import type { AuthenticatedRequest } from '../../auth/types';
import { isOperatorOrAdmin } from '../../events/controller.helpers';

/**
 * Omit the schema's absent optional fields so the parsed body satisfies
 * `CreatePollInput` under `exactOptionalPropertyTypes` (ROK-1161).
 */
function toCreatePollInput(data: CreateSchedulingPollDto): CreatePollInput {
  const {
    linkedEventId,
    durationHours,
    memberUserIds,
    minVoteThreshold,
    ...rest
  } = data;
  return {
    ...rest,
    ...(linkedEventId !== undefined ? { linkedEventId } : {}),
    ...(durationHours !== undefined ? { durationHours } : {}),
    ...(memberUserIds !== undefined ? { memberUserIds } : {}),
    ...(minVoteThreshold !== undefined ? { minVoteThreshold } : {}),
  };
}

@Controller('scheduling-polls')
@UseGuards(AuthGuard('jwt'))
export class StandalonePollController {
  constructor(private readonly service: StandalonePollService) {}

  /** List active standalone scheduling polls. */
  @Get('active')
  async listActive() {
    return this.service.listActive();
  }

  /** Mark a standalone poll as completed (after reschedule or event creation). */
  @Post(':matchId/complete')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: { eventId?: number; startTime?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const ok = await this.service.complete(
      matchId,
      body?.eventId,
      body?.startTime,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
    if (!ok) throw new NotFoundException('Poll not found');
    return { ok: true };
  }

  /**
   * Create a standalone scheduling poll.
   * Skips building/voting and jumps directly to scheduling.
   * No role guard — any authenticated user can create.
   */
  @Post()
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<SchedulingPollResponseDto> {
    const parsed = CreateSchedulingPollSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.service.create(
      toCreatePollInput(parsed.data),
      req.user.id,
      isOperatorOrAdmin(req.user.role),
    );
  }
}
