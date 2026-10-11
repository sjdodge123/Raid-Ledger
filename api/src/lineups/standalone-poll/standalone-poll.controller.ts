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
  type PollShareTokenResponseDto,
} from '@raid-ledger/contract';
import {
  StandalonePollService,
  type CreatePollInput,
} from './standalone-poll.service';
import { StandalonePollShareService } from './standalone-poll-share.service';
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
    visibility,
    ...rest
  } = data;
  return {
    ...rest,
    ...(visibility !== undefined ? { visibility } : {}),
    ...(linkedEventId !== undefined ? { linkedEventId } : {}),
    ...(durationHours !== undefined ? { durationHours } : {}),
    ...(memberUserIds !== undefined ? { memberUserIds } : {}),
    ...(minVoteThreshold !== undefined ? { minVoteThreshold } : {}),
  };
}

@Controller('scheduling-polls')
@UseGuards(AuthGuard('jwt'))
export class StandalonePollController {
  constructor(
    private readonly service: StandalonePollService,
    private readonly share: StandalonePollShareService,
  ) {}

  /** List active standalone polls the caller may see (ROK-1750: private
   *  polls only for their creator, invitees and admins). */
  @Get('active')
  async listActive(@Req() req: AuthenticatedRequest) {
    return this.service.listActive({
      id: req.user.id,
      isAdmin: isOperatorOrAdmin(req.user.role),
    });
  }

  /** ROK-1750: rotate a private poll's share link (creator / admin only). */
  @Post(':matchId/share-token/reset')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async resetShareToken(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<PollShareTokenResponseDto> {
    return this.share.reset(matchId, {
      id: req.user.id,
      isAdmin: isOperatorOrAdmin(req.user.role),
    });
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
