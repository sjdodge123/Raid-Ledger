/**
 * Tiebreaker REST controller (ROK-938).
 * 6 endpoints for tiebreaker management.
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
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import {
  StartTiebreakerSchema,
  CastBracketVoteSchema,
  CastVetoSchema,
} from '@raid-ledger/contract';
import { TiebreakerService } from './tiebreaker.service';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: string };
}

@Controller('lineups/:id/tiebreaker')
@UseGuards(AuthGuard('jwt'))
export class TiebreakerController {
  constructor(private readonly tiebreakerService: TiebreakerService) {}

  /** GET /lineups/:id/tiebreaker — tiebreaker detail. */
  @Get()
  async getDetail(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ) {
    return this.tiebreakerService.getDetail(id, req.user.id);
  }

  /** POST /lineups/:id/tiebreaker — start tiebreaker (operator). */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.CREATED)
  async start(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const parsed = StartTiebreakerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.tiebreakerService.start(id, parsed.data);
  }

  /** POST /lineups/:id/tiebreaker/dismiss — dismiss (operator). */
  @Post('dismiss')
  @UseGuards(RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.OK)
  async dismiss(@Param('id', ParseIntPipe) id: number) {
    await this.tiebreakerService.dismiss(id);
    return { ok: true };
  }

  /** POST /lineups/:id/tiebreaker/bracket-vote — vote on matchup. */
  @Post('bracket-vote')
  @HttpCode(HttpStatus.OK)
  async bracketVote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const parsed = CastBracketVoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.tiebreakerService.castBracketVote(id, parsed.data, req.user.id);
  }

  /** POST /lineups/:id/tiebreaker/veto — submit a veto. */
  @Post('veto')
  @HttpCode(HttpStatus.OK)
  async submitVeto(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const parsed = CastVetoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.tiebreakerService.castVeto(id, parsed.data, req.user.id);
  }

  /** POST /lineups/:id/tiebreaker/resolve — force-resolve (operator). */
  @Post('resolve')
  @UseGuards(RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.OK)
  async forceResolve(@Param('id', ParseIntPipe) id: number) {
    await this.tiebreakerService.forceResolve(id);
    return { ok: true };
  }
}
