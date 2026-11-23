import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { HubForumReply, SubjectDiscussion } from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../../../auth/types';
import { LineupDiscussionReplyThrottleGuard } from './lineup-discussion-throttle.guard';
import { LineupDiscussionService } from './lineup-discussion.service';

const NO_STORE = 'private, no-store';
const LineupId = (): ParameterDecorator => Param('id', ParseIntPipe);

/**
 * ROK-2272 S7b (R10) — community-lineup discussion routes (JWT only, like
 * the event and poll routes). Mounted under the existing `lineups/:id` prefix
 * the web already uses (R10 named `community-lineups`; no such prefix
 * exists). Access is the R7 matrix in the service / thread context. Edit,
 * delete and the full thread view stay on the hub forum routes.
 */
@Controller('lineups/:id/discussion')
@UseGuards(AuthGuard('jwt'))
export class LineupDiscussionController {
  constructor(private readonly discussion: LineupDiscussionService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  summary(
    @Request() req: AuthenticatedRequest,
    @LineupId() lineupId: number,
  ): Promise<SubjectDiscussion> {
    return this.discussion.summary(req.user, lineupId);
  }

  @Post('replies')
  @UseGuards(LineupDiscussionReplyThrottleGuard)
  createReply(
    @Request() req: AuthenticatedRequest,
    @LineupId() lineupId: number,
    @Body() body: unknown,
  ): Promise<HubForumReply> {
    return this.discussion.createReply(req.user, lineupId, body);
  }
}
