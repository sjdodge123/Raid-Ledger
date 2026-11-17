import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  HubForumDiscordChannelOptions,
  HubForumDiscordPreflight,
  HubForumDiscordStatus,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import { GuildEditorGuard } from '../../guild-editor.guard';
import { GuildLeaderGuard } from '../../guild-leader.guard';
import { HubKindActiveGuard } from '../../hub-kind-active.guard';
import { HubForumDiscordService } from './hub-forum-discord.service';

const jwt = AuthGuard('jwt');
const NO_STORE = 'private, no-store';
const Id = (): ParameterDecorator => Param('id', ParseIntPipe);

/**
 * ROK-2208 §5.1 — the hub Forum's Discord forum binding. Not under
 * `guilds/:id/forum/…`: that controller's `:threadId` routes would swallow
 * it. Leaders (one `canManageDiscord` gate, shared and dedicated alike)
 * bind/unbind; Officers and staff may read the status (§6).
 */
@Controller('guilds/:id/forum-discord')
@UseGuards(HubKindActiveGuard)
export class HubForumDiscordController {
  constructor(private readonly service: HubForumDiscordService) {}

  /** The hub's binding, or `{ binding: null }`. */
  @Get()
  @UseGuards(jwt, GuildEditorGuard)
  @Header('Cache-Control', NO_STORE)
  status(@Id() id: number): Promise<HubForumDiscordStatus> {
    return this.service.status(id);
  }

  /** Forum channels the picker offers for `existing`. */
  @Get('channels')
  @UseGuards(jwt, GuildLeaderGuard)
  @Header('Cache-Control', NO_STORE)
  channels(): Promise<HubForumDiscordChannelOptions> {
    return this.service.channels();
  }

  /** Before binding: bot online, missing perms, the shared #hub-forums. */
  @Get('preflight')
  @UseGuards(jwt, GuildLeaderGuard)
  @Header('Cache-Control', NO_STORE)
  preflight(@Id() id: number): Promise<HubForumDiscordPreflight> {
    return this.service.preflight(id);
  }

  /** Bind: `{ mode, channelId?, target?, name?, ack: true }`. */
  @Put()
  @UseGuards(jwt, GuildLeaderGuard)
  bind(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @Body() body: unknown,
  ): Promise<HubForumDiscordStatus> {
    return this.service.bind(req.user, id, body);
  }

  /** Unlink; `?deleteForum=true` also deletes an unshared bot-made forum. */
  @Delete()
  @HttpCode(204)
  @UseGuards(jwt, GuildLeaderGuard)
  async unbind(
    @Id() id: number,
    @Query('deleteForum') deleteForum?: string,
  ): Promise<void> {
    await this.service.unbind(id, deleteForum === 'true');
  }
}
