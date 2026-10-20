import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  CreateHubPostResponse,
  HubPost,
  HubPostComposer,
  HubPostList,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { GuildEditorGuard } from '../guild-editor.guard';
import { HubKindActiveGuard } from '../hub-kind-active.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { HubPostThrottleGuard } from './hub-post-throttle.guard';
import { HubPostsService } from './hub-posts.service';

const jwt = AuthGuard('jwt');
const NO_STORE = 'private, no-store';

/**
 * ROK-1868 §2.3 — the hub post feed at `guilds/:id/posts`, every hub kind.
 * The literal `composer` route is declared BEFORE `:postId`; `ParseIntPipe`
 * keeps any other non-numeric segment from reaching a handler.
 */
@Controller('guilds/:id/posts')
@UseGuards(HubKindActiveGuard)
export class HubPostsController {
  constructor(private readonly posts: HubPostsService) {}

  /** Newest-first, cursor-paged feed. */
  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  @Header('Cache-Control', NO_STORE)
  list(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: unknown,
  ): Promise<HubPostList> {
    return this.posts.list(req.user, id, query);
  }

  /** The composer's relay default + channel state (editors only). */
  @Get('composer')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @Header('Cache-Control', NO_STORE)
  composer(@Param('id', ParseIntPipe) id: number): Promise<HubPostComposer> {
    return this.posts.composer(id);
  }

  /** One post of this hub. */
  @Get(':postId')
  @UseGuards(jwt, HubVisibleGuard)
  @Header('Cache-Control', NO_STORE)
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<HubPost> {
    return this.posts.get(req.user, id, postId);
  }

  /** New post (notifies; relays when asked and available). */
  @Post()
  @UseGuards(jwt, HubPostThrottleGuard, HubVisibleGuard, GuildEditorGuard)
  create(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<CreateHubPostResponse> {
    return this.posts.create(req.user, id, body);
  }

  /** Edit a post's body (never notifies, never touches Discord). */
  @Patch(':postId')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() body: unknown,
  ): Promise<HubPost> {
    return this.posts.update(req.user, id, postId, body);
  }

  /** Hard delete (+ best-effort removal of the relayed message). */
  @Delete(':postId')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @HttpCode(204)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Param('postId', ParseIntPipe) postId: number,
  ): Promise<void> {
    return this.posts.remove(id, postId);
  }
}
