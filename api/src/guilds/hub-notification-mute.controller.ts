import {
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubNotificationMuteResponseDto } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { setHubMute } from '../notifications/hub-notification-mute.helpers';
import { GuildAccessService } from './guild-access.service';
import { HubKindActiveGuard } from './hub-kind-active.guard';
import { HubVisibleGuard } from './hub-visible.guard';

const jwt = AuthGuard('jwt');

/** 403 body for a caller who is not a member of the group (staff included). */
export const MUTE_MEMBERS_ONLY = 'Only members can mute this group';

/**
 * ROK-1832 — the per-group (hub) notification bell at `guilds/:id`. Kept out
 * of `HubController` (near the size cap), mirroring the ROK-1797 per-game
 * mute routes. Muting is a member's choice: staff rights do not confer it.
 * `HubKindActiveGuard` sits on the POST only: an unmute must still work once
 * the kind's plugin is off, because `/notifications/hub-mutes` keeps listing it.
 */
@Controller('guilds/:id')
export class HubNotificationMuteController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  /** POST /guilds/:id/notification-mute -- Mute (members only, idempotent). */
  @Post('notification-mute')
  @UseGuards(HubKindActiveGuard, jwt, HubVisibleGuard)
  @HttpCode(HttpStatus.OK)
  async mute(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<HubNotificationMuteResponseDto> {
    if (!(await this.access.isMember(req.user.id, id))) {
      throw new ForbiddenException(MUTE_MEMBERS_ONLY);
    }
    await setHubMute(this.db, req.user.id, id, true);
    return { guildId: id, muted: true };
  }

  /** DELETE /guilds/:id/notification-mute -- Unmute; no 404 without a row. */
  @Delete('notification-mute')
  @UseGuards(jwt)
  @HttpCode(HttpStatus.OK)
  async unmute(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<HubNotificationMuteResponseDto> {
    await setHubMute(this.db, req.user.id, id, false);
    return { guildId: id, muted: false };
  }
}
