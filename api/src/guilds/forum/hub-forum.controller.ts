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
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  HubForumLatest,
  HubForumReply,
  HubForumThread,
  HubForumThreadList,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../auth/types';
import { GuildEditorGuard } from '../guild-editor.guard';
import { HubKindActiveGuard } from '../hub-kind-active.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { HubForumThrottleGuard } from './hub-forum-throttle.guard';
import { HubForumService } from './hub-forum.service';

const jwt = AuthGuard('jwt');
const NO_STORE = 'private, no-store';
const Id = (): ParameterDecorator => Param('id', ParseIntPipe);
const ThreadId = (): ParameterDecorator => Param('threadId', ParseIntPipe);
const ReplyId = (): ParameterDecorator => Param('replyId', ParseIntPipe);

/**
 * ROK-1175 — the hub forum at `guilds/:id/forum`, every hub kind (Core).
 * Guards copy the Posts stack (D8); membership and authorship are checked
 * in `HubForumService`. The literal `latest` route precedes `:threadId`.
 */
@Controller('guilds/:id/forum')
@UseGuards(HubKindActiveGuard)
export class HubForumController {
  constructor(private readonly forum: HubForumService) {}

  /** Pinned (first page) + activity feed. */
  @Get()
  @UseGuards(jwt, HubVisibleGuard)
  @Header('Cache-Control', NO_STORE)
  list(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @Query() query: unknown,
  ): Promise<HubForumThreadList> {
    return this.forum.list(req.user, id, query);
  }

  /** The Latest threads widget. */
  @Get('latest')
  @UseGuards(jwt, HubVisibleGuard)
  @Header('Cache-Control', NO_STORE)
  latest(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
  ): Promise<HubForumLatest> {
    return this.forum.latest(req.user, id);
  }

  /** One thread + a page of replies. */
  @Get(':threadId')
  @UseGuards(jwt, HubVisibleGuard)
  @Header('Cache-Control', NO_STORE)
  get(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
    @Query() query: unknown,
  ): Promise<HubForumThread> {
    return this.forum.get(req.user, id, threadId, query);
  }

  /** New thread (members). */
  @Post()
  @UseGuards(jwt, HubForumThrottleGuard, HubVisibleGuard)
  create(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @Body() body: unknown,
  ): Promise<HubForumThread> {
    return this.forum.createThread(req.user, id, body);
  }

  /** Author edit within 24 h. */
  @Patch(':threadId')
  @UseGuards(jwt, HubVisibleGuard)
  update(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
    @Body() body: unknown,
  ): Promise<HubForumThread> {
    return this.forum.updateThread(req.user, id, threadId, body);
  }

  /** Soft delete (author or moderator). */
  @Delete(':threadId')
  @UseGuards(jwt, HubVisibleGuard)
  @HttpCode(204)
  remove(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
  ): Promise<void> {
    return this.forum.deleteThread(req.user, id, threadId);
  }

  /** Pin (officer/leader + staff). */
  @Put(':threadId/pin')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @HttpCode(204)
  pin(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
  ): Promise<void> {
    return this.forum.setPin(req.user, id, threadId, true);
  }

  /** Unpin (officer/leader + staff). */
  @Delete(':threadId/pin')
  @UseGuards(jwt, HubVisibleGuard, GuildEditorGuard)
  @HttpCode(204)
  unpin(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
  ): Promise<void> {
    return this.forum.setPin(req.user, id, threadId, false);
  }

  /** New reply (members); 409 on a removed thread. */
  @Post(':threadId/replies')
  @UseGuards(jwt, HubForumThrottleGuard, HubVisibleGuard)
  reply(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
    @Body() body: unknown,
  ): Promise<HubForumReply> {
    return this.forum.createReply(req.user, id, threadId, body);
  }

  /** Author edit of a reply within 24 h. */
  @Patch(':threadId/replies/:replyId')
  @UseGuards(jwt, HubVisibleGuard)
  updateReply(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
    @ReplyId() replyId: number,
    @Body() body: unknown,
  ): Promise<HubForumReply> {
    return this.forum.updateReply(req.user, id, threadId, replyId, body);
  }

  /** Soft delete a reply (author or moderator). */
  @Delete(':threadId/replies/:replyId')
  @UseGuards(jwt, HubVisibleGuard)
  @HttpCode(204)
  removeReply(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ThreadId() threadId: number,
    @ReplyId() replyId: number,
  ): Promise<void> {
    return this.forum.deleteReply(req.user, id, threadId, replyId);
  }
}
