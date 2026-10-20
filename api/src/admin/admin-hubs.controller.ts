import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AdminCreateHubSchema,
  ApproveHubProposalSchema,
  RejectHubProposalSchema,
  type GuildSummary,
  type HubProposalList,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  listAdminHubs,
  type AdminHubEntry,
} from '../guilds/community/admin-hubs.queries';
import { parseBody } from '../guilds/community/community-proposals.body';
import { CommunityProposalsService } from '../guilds/community/community-proposals.service';

/** ROK-1870 — Admin → Hubs: the proposal queue, review, direct create, list. */
@Controller('admin/hubs')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminHubsController {
  constructor(
    private readonly proposals: CommunityProposalsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @Query('status') status: string | undefined,
  ): Promise<{ items: AdminHubEntry[] }> {
    const s = status ?? 'active';
    if (s !== 'active' && s !== 'archived') {
      throw new BadRequestException({
        status: ['Expected active or archived'],
      });
    }
    return { items: await listAdminHubs(this.db, s) };
  }

  @Get('proposals')
  @Header('Cache-Control', 'private, no-store')
  queue(): Promise<HubProposalList> {
    return this.proposals.queue();
  }

  @Post('proposals/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<GuildSummary> {
    return this.proposals.approve(
      req.user.id,
      id,
      parseBody(ApproveHubProposalSchema, body ?? {}),
    );
  }

  @Post('proposals/:id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<void> {
    return this.proposals.reject(
      id,
      parseBody(RejectHubProposalSchema, body).reason,
    );
  }

  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<GuildSummary> {
    return this.proposals.createDirect(
      req.user.id,
      parseBody(AdminCreateHubSchema, body),
    );
  }
}
