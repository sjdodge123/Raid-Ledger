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
  CompleteSchedulingPollSchema,
  CreateSchedulingPollSchema,
  LockInSchedulingPollSchema,
  type CreateSchedulingPollDto,
  type LockInSchedulingPollResponseDto,
  type SchedulingPollResponseDto,
  type PollShareTokenResponseDto,
} from '@raid-ledger/contract';
import {
  StandalonePollService,
  type CreatePollInput,
} from './standalone-poll.service';
import { StandalonePollShareService } from './standalone-poll-share.service';
import { StandalonePollLockInService } from './standalone-poll-lock-in.service';
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
    hubId,
    ...rest
  } = data;
  return {
    ...rest,
    ...(visibility !== undefined ? { visibility } : {}),
    ...(linkedEventId !== undefined ? { linkedEventId } : {}),
    ...(durationHours !== undefined ? { durationHours } : {}),
    ...(memberUserIds !== undefined ? { memberUserIds } : {}),
    ...(minVoteThreshold !== undefined ? { minVoteThreshold } : {}),
    ...(hubId !== undefined ? { hubId } : {}),
  };
}

@Controller('scheduling-polls')
@UseGuards(AuthGuard('jwt'))
export class StandalonePollController {
  constructor(
    private readonly service: StandalonePollService,
    private readonly share: StandalonePollShareService,
    private readonly lockInService: StandalonePollLockInService,
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

  /** Mark a standalone poll as completed (after reschedule or event creation).
   *  ROK-1844: creator / linked-event creator / staff only; 409 once done. */
  @Post(':matchId/complete')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    // ROK-1844: strict runtime validation — the body names the event every
    // yes-voter is signed up to, so a malformed one is a 400, never a guess.
    const parsed = CompleteSchedulingPollSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const ok = await this.service.complete(
      matchId,
      parsed.data.eventId,
      parsed.data.startTime,
      req.user.id,
      isOperatorOrAdmin(req.user.role),
      parsed.data.benchUserIds,
    );
    if (!ok) throw new NotFoundException('Poll not found');
    return { ok: true };
  }

  /**
   * ROK-2032: lock a poll in from the create form, claim-first. The event is
   * created only after the poll is claimed, so a concurrent second lock-in
   * gets a 409 (`SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE`) and no event.
   * Resolves once the slot voters are signed up (ROK-2031).
   */
  @Post(':matchId/lock-in')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async lockIn(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LockInSchedulingPollResponseDto> {
    const parsed = LockInSchedulingPollSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.lockInService.lockIn(matchId, req.user, parsed.data);
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
