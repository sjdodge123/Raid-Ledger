/**
 * HTTP surface for LFG intents (ROK-1451).
 *
 * Literal sub-routes are declared BEFORE `:gameId` — Nest matches in
 * declaration order, so `/lfg/hearted` must win over `/lfg/:gameId`.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import {
  ConvertLfgIntentsSchema,
  CreateLfgIntentSchema,
  type LfgConvertResponseDto,
  type LfgClearOfferDto,
  type LfgGroupDetailDto,
  type LfgGroupSummaryDto,
  type LfgHeartedGameDto,
  type LfgIntentResponseDto,
  type LfgOverlapResponseDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { LfgService } from './lfg.service';

@Controller('lfg')
@UseGuards(AuthGuard('jwt'))
export class LfgController {
  constructor(private readonly service: LfgService) {}

  /**
   * Post an intent. 201 when a row was created, 200 on an idempotent hit or a
   * revive — never an error for a re-post.
   */
  @Post()
  @UseGuards(NotDeactivatedGuard)
  async create(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LfgIntentResponseDto> {
    const parsed = CreateLfgIntentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const result = await this.service.createIntent(
      req.user.id,
      parsed.data.gameId,
    );
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.body;
  }

  /** Active intents grouped by game, busiest first. */
  @Get()
  listGroups(@Req() req: AuthenticatedRequest): Promise<LfgGroupSummaryDto[]> {
    return this.service.listGroups(req.user.id);
  }

  /** Cold-start read: hearted games the caller has not posted an intent for. */
  @Get('hearted')
  listHearted(@Req() req: AuthenticatedRequest): Promise<LfgHeartedGameDto[]> {
    return this.service.listHearted(req.user.id);
  }

  /**
   * Quick Play sessions that offer to clear a matching intent. Inert — the
   * player acts on an offer with `DELETE /lfg/:gameId` (AC7c).
   */
  @Get('offers')
  listOffers(@Req() req: AuthenticatedRequest): Promise<LfgClearOfferDto[]> {
    return this.service.listOffers(req.user.id);
  }

  /** Group detail. 200 with a zero-count group when nobody is looking. */
  @Get(':gameId')
  getGroup(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgGroupDetailDto> {
    return this.service.getGroupDetail(req.user.id, gameId);
  }

  /** Group-page read: the windows the live roster could all play in. */
  @Get(':gameId/overlap')
  getOverlap(
    @Param('gameId', ParseIntPipe) gameId: number,
  ): Promise<LfgOverlapResponseDto> {
    return this.service.getOverlap(gameId);
  }

  /** Withdraw the caller's own intent. */
  @Delete(':gameId')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.service.withdraw(req.user.id, gameId);
  }

  /** Record that this group converted into a poll or an event. */
  @Post(':gameId/convert')
  @UseGuards(NotDeactivatedGuard)
  async convert(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgConvertResponseDto> {
    const parsed = ConvertLfgIntentsSchema.safeParse(body);
    if (!parsed.success) {
      // N2: mirror `create` and report the offending FIELD. Hard-coding the
      // XOR message made a malformed `pollId` (a string, a negative) read as
      // "supply exactly one", which was not the problem. The XOR rule is a
      // schema-level refine, so it lands in `formErrors` — fall back to it
      // when no individual field is at fault.
      const { fieldErrors, formErrors } = parsed.error.flatten();
      throw new BadRequestException(
        Object.keys(fieldErrors).length > 0 ? fieldErrors : formErrors,
      );
    }
    return this.service.convert(req.user.id, gameId, parsed.data);
  }
}
