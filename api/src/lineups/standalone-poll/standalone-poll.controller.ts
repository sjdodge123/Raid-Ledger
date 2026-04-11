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
import {
  CreateSchedulingPollSchema,
  type SchedulingPollResponseDto,
} from '@raid-ledger/contract';
import { StandalonePollService } from './standalone-poll.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string };
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
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Body() body: { eventId?: number },
  ) {
    const ok = await this.service.complete(matchId, body?.eventId);
    if (!ok) throw new NotFoundException('Poll not found');
    return { ok: true };
  }

  /**
   * Create a standalone scheduling poll.
   * Skips building/voting and jumps directly to scheduling.
   * No role guard — any authenticated user can create.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ): Promise<SchedulingPollResponseDto> {
    const parsed = CreateSchedulingPollSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.service.create(parsed.data, req.user.id);
  }
}
