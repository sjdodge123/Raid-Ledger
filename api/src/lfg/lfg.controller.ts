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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import {
  ConvertLfgIntentsSchema,
  CreateLfgIntentSchema,
  LfgDeleteGroupQuerySchema,
  LfgGroupListQuerySchema,
  LfgGroupQuerySchema,
  LfgInviteRequestSchema,
  type LfgInviteResponseDto,
  type LfgConvertResponseDto,
  type LfgClearOfferDto,
  type LfgGroupDetailDto,
  type LfgGroupListResponseDto,
  type LfgGroupSummaryDto,
  type LfgHeartedGameDto,
  type LfgIntentResponseDto,
  type LfgHistoryResponseDto,
  type LfgOverlapResponseDto,
  type LfgSuggestionsResponseDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { LfgService } from './lfg.service';
import { LfgReadsService } from './lfg-reads.service';
import { LfgInviteService } from './lfg-invite.service';
import { parseQuery } from './lfg-query-parse.helpers';

@Controller('lfg')
@UseGuards(AuthGuard('jwt'))
export class LfgController {
  constructor(
    private readonly service: LfgService,
    private readonly reads: LfgReadsService,
    private readonly invites: LfgInviteService,
  ) {}

  /**
   * Post an intent. 201 when a row was created, 200 on an idempotent hit, a
   * revive or an urgency BUMP — never an error for a re-post.
   *
   * `urgency` / `ttlMinutes` are passed straight through from the parsed body
   * (ROK-1479 AC1). `urgency` is never undefined here — `CreateLfgIntentSchema`
   * carries `.default('week')`, which is what keeps a pre-1479 client sending
   * only `gameId` on the week horizon. The `week` + `ttlMinutes` rejection
   * (A2) is the schema's `.superRefine`, so it lands in `fieldErrors` on
   * `ttlMinutes` through the existing 400 below.
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
      {
        urgency: parsed.data.urgency,
        ...(parsed.data.ttlMinutes !== undefined
          ? { ttlMinutes: parsed.data.ttlMinutes }
          : {}),
        // ROK-2352: folded / adapter-checked by the service.
        ...(parsed.data.groupKey !== undefined
          ? { groupKey: parsed.data.groupKey }
          : {}),
        ...(parsed.data.handDetail !== undefined
          ? { handDetail: parsed.data.handDetail }
          : {}),
      },
      // ROK-2352 §3.3: a web/API hand in a plugin group must carry roles.
      { requireHandDetail: true },
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

  /** Group detail (`?group=`, default `''`). 200 with a zero-count group when nobody is looking. */
  @Get(':gameId')
  getGroup(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgGroupDetailDto> {
    const { group } = parseQuery(LfgGroupQuerySchema, query);
    return this.service.getGroupDetail(req.user.id, gameId, group);
  }

  /** ROK-2352: the game's groups, `''` first; `?include=catalogue` adds empty ones. */
  @Get(':gameId/groups')
  listGameGroups(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgGroupListResponseDto> {
    const { include } = parseQuery(LfgGroupListQuerySchema, query);
    return this.reads.listGameGroups(
      req.user.id,
      gameId,
      include === 'catalogue',
    );
  }

  /** Group-page read (`?group=`): the windows the live roster could all play in. */
  @Get(':gameId/overlap')
  getOverlap(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: unknown,
  ): Promise<LfgOverlapResponseDto> {
    const { group } = parseQuery(LfgGroupQuerySchema, query);
    return this.reads.getOverlap(gameId, group);
  }

  /** Group-page read: past sessions. `?group` is validated; history is per game. */
  @Get(':gameId/history')
  getHistory(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: unknown,
  ): Promise<LfgHistoryResponseDto> {
    parseQuery(LfgGroupQuerySchema, query);
    return this.reads.getHistory(gameId);
  }

  /** Group-page read (`?group=`): players who might want in on this group. */
  @Get(':gameId/suggestions')
  getSuggestions(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgSuggestionsResponseDto> {
    const { group } = parseQuery(LfgGroupQuerySchema, query);
    return this.reads.getSuggestions(req.user.id, gameId, group);
  }

  /** Withdraw the caller's own intent. */
  @Delete(':gameId')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const { group } = parseQuery(LfgDeleteGroupQuerySchema, query);
    return this.service.withdraw(req.user.id, gameId, group);
  }

  /**
   * Invite a suggested player to this group (ROK-1455 D6). Always 200 with
   * `{ status, reason }` for recipient-scoped outcomes; 429 when the group's
   * daily cap is spent; 400 self-invite; 403 when the caller is not in the group.
   */
  @Post(':gameId/invites')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async invite(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Body() body: unknown,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LfgInviteResponseDto> {
    const parsed = LfgInviteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const { group } = parseQuery(LfgGroupQuerySchema, query);
    return this.invites.invite(req.user.id, gameId, parsed.data.userId, group);
  }

  /** Record that this group converted into a poll or an event. */
  @Post(':gameId/convert')
  @UseGuards(NotDeactivatedGuard)
  async convert(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Body() body: unknown,
    @Query() query: unknown,
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
    // ROK-2352: `?group` (default `''`) — only that group's hands convert.
    const { group } = parseQuery(LfgGroupQuerySchema, query);
    return this.service.convert(req.user.id, gameId, parsed.data, group);
  }
}
