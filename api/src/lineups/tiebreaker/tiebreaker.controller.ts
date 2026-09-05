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
import { z } from 'zod';
import { RolesGuard } from '../../auth/roles.guard';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import { Roles } from '../../auth/roles.decorator';
import {
  StartTiebreakerSchema,
  CastBracketVoteSchema,
  CastVetoSchema,
} from '@raid-ledger/contract';
import { TiebreakerService } from './tiebreaker.service';
import type { TiePickActor } from './tie-pick.helpers';

interface AuthRequest extends Request {
  user: { id: number; username: string; role: TiePickActor['role'] };
}

/**
 * TODO(ROK-1374 C1): replace with `PickTiebreakerSchema` from
 * `@raid-ledger/contract` once Lane C1's `lineup-tie.schema.ts` lands. Kept
 * local only so this lane does not race Lane C1 on the contract package.
 */
const PickTieGameSchema = z.object({ gameId: z.number().int().positive() });

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

  /**
   * POST /lineups/:id/tiebreaker — start a tiebreaker mode.
   *
   * D15: `RolesGuard` + `@Roles('operator')` are removed HERE AND ONLY HERE.
   * Authorisation moved into the service as `assertCanPickTiebreaker` because
   * "the lineup creator" is a row fact no role decorator can express.
   * `/dismiss` and `/resolve` below keep `@Roles('operator')` unchanged.
   */
  @Post()
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const parsed = StartTiebreakerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.tiebreakerService.start(id, parsed.data, req.user);
  }

  /** POST /lineups/:id/tiebreaker/pick — pick one of the tied games. */
  @Post('pick')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async pick(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    const parsed = PickTieGameSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.tiebreakerService.pickGame(id, req.user, parsed.data.gameId);
  }

  /** POST /lineups/:id/tiebreaker/pick/undo — reverse a pending pick. */
  @Post('pick/undo')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async undoPick(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthRequest,
  ) {
    return this.tiebreakerService.undoPick(id, req.user);
  }

  /** POST /lineups/:id/tiebreaker/dismiss — dismiss (operator). */
  @Post('dismiss')
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.OK)
  async dismiss(@Param('id', ParseIntPipe) id: number) {
    await this.tiebreakerService.dismiss(id);
    return { ok: true };
  }

  /** POST /lineups/:id/tiebreaker/bracket-vote — vote on matchup. */
  @Post('bracket-vote')
  @UseGuards(NotDeactivatedGuard)
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
  @UseGuards(NotDeactivatedGuard)
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
  @UseGuards(NotDeactivatedGuard, RolesGuard)
  @Roles('operator')
  @HttpCode(HttpStatus.OK)
  async forceResolve(@Param('id', ParseIntPipe) id: number) {
    await this.tiebreakerService.forceResolve(id);
    return { ok: true };
  }
}
