/**
 * Controller for standalone scheduling polls (ROK-977).
 * POST /scheduling-polls — any authenticated user can create.
 */
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
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
