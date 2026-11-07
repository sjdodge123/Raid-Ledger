import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { RosterClaimListResponseDto } from '@raid-ledger/contract';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import { RosterClaimService } from './roster-claim.service';

/**
 * ROK-2128 — `/plugins/wow/roster-claim`: the Add character "Guild roster"
 * pick list. Any signed-in active user (a deactivated session is refused by
 * the JWT strategy). L2 adds `POST members/:memberId/claim` here.
 */
@Controller('plugins/wow/roster-claim')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class RosterClaimController {
  constructor(private readonly service: RosterClaimService) {}

  /** `?gameId=` → unclaimed candidates grouped by guild (FLAG 1, D2). */
  @Get('candidates')
  candidates(
    @Query() query: Record<string, unknown>,
  ): Promise<RosterClaimListResponseDto> {
    return this.service.listCandidates(query);
  }
}
