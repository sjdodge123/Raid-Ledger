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
  EventDiscussion,
  HubForumReply,
  HubForumThread,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import { EventDiscussionService } from './event-discussion.service';

const NO_STORE = 'private, no-store';
const Id = (): ParameterDecorator => Param('id', ParseIntPipe);
const ReplyId = (): ParameterDecorator => Param('replyId', ParseIntPipe);

/**
 * ROK-2226 §6.1 — event-scoped discussion routes (JWT only; logged-out gets
 * nothing, ruling 15). Access is the §6 matrix in the service, so the
 * signed-up non-member path never touches the hub-forum guards.
 */
@Controller('events/:id/discussion')
@UseGuards(AuthGuard('jwt'))
export class EventDiscussionController {
  constructor(private readonly discussion: EventDiscussionService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  summary(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
  ): Promise<EventDiscussion> {
    return this.discussion.summary(req.user, id);
  }

  @Get('thread')
  @Header('Cache-Control', NO_STORE)
  thread(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @Query() query: unknown,
  ): Promise<HubForumThread> {
    return this.discussion.thread(req.user, id, query);
  }

  @Post('replies')
  createReply(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @Body() body: unknown,
  ): Promise<HubForumReply> {
    return this.discussion.createReply(req.user, id, body);
  }

  @Patch('replies/:replyId')
  updateReply(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ReplyId() replyId: number,
    @Body() body: unknown,
  ): Promise<HubForumReply> {
    return this.discussion.updateReply(req.user, id, replyId, body);
  }

  @Delete('replies/:replyId')
  @HttpCode(204)
  deleteReply(
    @Request() req: AuthenticatedRequest,
    @Id() id: number,
    @ReplyId() replyId: number,
  ): Promise<void> {
    return this.discussion.deleteReply(req.user, id, replyId);
  }
}
