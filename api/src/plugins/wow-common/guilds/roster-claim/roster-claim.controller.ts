import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  CharacterDto,
  RosterClaimListResponseDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../../auth/types';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { RosterClaimService } from './roster-claim.service';

/**
 * ROK-2128 — `/plugins/wow/roster-claim`: the Add character "Guild roster"
 * pick list. Any signed-in active user (a deactivated session is refused by
 * the JWT strategy). `POST members/:memberId/claim` is the one-click claim.
 */
@Controller('plugins/wow/roster-claim')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class RosterClaimController {
  constructor(private readonly service: RosterClaimService) {}

  /** `?gameId=&q=&guildId=` → unclaimed candidates grouped by guild (FLAG 1, D2). */
  @Get('candidates')
  candidates(
    @Query() query: Record<string, unknown>,
  ): Promise<RosterClaimListResponseDto> {
    return this.service.listCandidates(query);
  }

  /**
   * One-click claim of an unclaimed roster row (D3–D5). 201 + the new
   * character; 400 bad body; 404 row gone/not visible; 409 claimed first.
   */
  @Post('members/:memberId/claim')
  claim(
    @Request() req: AuthenticatedRequest,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() body: unknown,
  ): Promise<CharacterDto> {
    return this.service.claim(req.user.id, memberId, body);
  }
}
