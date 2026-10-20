import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  CreateHubProposalSchema,
  type HubProposal,
  type HubProposalList,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { CommunityProposalsService } from './community-proposals.service';
import { parseBody } from './community-proposals.body';

/** D12: 5 proposal POSTs per hour (lifted when THROTTLE_DISABLED, as every tier). */
const PROPOSE_LIMIT = process.env.THROTTLE_DISABLED === 'true' ? 999_999 : 5;

/**
 * ROK-1870 — `hubs/proposals`. Registered BEFORE the `hubs` controller so the
 * literal path wins over `hubs/:id` (the `guilds/mine` precedent).
 */
@Controller('hubs/proposals')
@UseGuards(AuthGuard('jwt'))
export class CommunityProposalsController {
  constructor(private readonly proposals: CommunityProposalsService) {}

  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: PROPOSE_LIMIT } })
  propose(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<HubProposal> {
    return this.proposals.propose(
      req.user,
      parseBody(CreateHubProposalSchema, body),
    );
  }

  @Get('mine')
  @Header('Cache-Control', 'private, no-store')
  mine(@Request() req: AuthenticatedRequest): Promise<HubProposalList> {
    return this.proposals.mine(req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.proposals.withdraw(req.user.id, id);
  }
}
