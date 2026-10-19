import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  HubJoinResponseSchema,
  HubQuickPlayListSchema,
} from '@raid-ledger/contract';
import type { HubJoinResponse, HubQuickPlayList } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Inject } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../auth/types';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { HubVisibleGuard } from '../../../guilds/hub-visible.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { PELICAN_PLUGIN_ID } from '../pelican.constants';
import { findVisibleServerHub } from './server-hub-join.queries';
import { ServerHubMembershipService } from './server-hub-membership.service';
import {
  clampQuickPlayLimit,
  listQuickPlays,
} from './server-hub-quick-play.queries';

/**
 * ROK-1831 server-hub endpoints. A hidden hub is 404 for non-staff
 * (`HubVisibleGuard`); Join/Leave are also 404 on a hidden or non-server hub.
 */
@Controller('plugins/pelican/hubs/:id')
@UseGuards(AuthGuard('jwt'), PluginActiveGuard, HubVisibleGuard)
@RequirePlugin(PELICAN_PLUGIN_ID)
export class PelicanHubController {
  constructor(
    private readonly membership: ServerHubMembershipService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** POST plugins/pelican/hubs/:id/join — manual member, idempotent. */
  @Post('join')
  async join(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<HubJoinResponse> {
    return HubJoinResponseSchema.parse(
      await this.membership.join(id, req.user.id),
    );
  }

  /** DELETE plugins/pelican/hubs/:id/join — Leave (`left_at = now()`). */
  @Delete('join')
  async leave(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<HubJoinResponse> {
    return HubJoinResponseSchema.parse(
      await this.membership.leave(id, req.user.id),
    );
  }

  /** GET plugins/pelican/hubs/:id/quick-play?limit=20 — this server's Quick Plays, newest first. */
  @Get('quick-play')
  async quickPlay(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
  ): Promise<HubQuickPlayList> {
    const { pelicanServerId } = await findVisibleServerHub(this.db, id);
    const data =
      pelicanServerId === null
        ? []
        : await listQuickPlays(
            this.db,
            pelicanServerId,
            clampQuickPlayLimit(limit),
          );
    return HubQuickPlayListSchema.parse({ data });
  }
}
