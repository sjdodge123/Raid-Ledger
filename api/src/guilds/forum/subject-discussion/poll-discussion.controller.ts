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
import { PollDiscussionReplyThrottleGuard } from './poll-discussion-throttle.guard';
import { PollDiscussionService } from './poll-discussion.service';

const NO_STORE = 'private, no-store';
const MatchId = (): ParameterDecorator => Param('matchId', ParseIntPipe);

/**
 * ROK-2272 S7a (R10) — scheduling-poll discussion routes (JWT only, like the
 * event routes). Access is the R7 matrix in the service / thread context.
 * Edit, delete and the full thread view stay on the hub forum routes.
 */
@Controller('scheduling-polls/:matchId/discussion')
@UseGuards(AuthGuard('jwt'))
export class PollDiscussionController {
  constructor(private readonly discussion: PollDiscussionService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  summary(
    @Request() req: AuthenticatedRequest,
    @MatchId() matchId: number,
  ): Promise<SubjectDiscussion> {
    return this.discussion.summary(req.user, matchId);
  }

  @Post('replies')
  @UseGuards(PollDiscussionReplyThrottleGuard)
  createReply(
    @Request() req: AuthenticatedRequest,
    @MatchId() matchId: number,
    @Body() body: unknown,
  ): Promise<HubForumReply> {
    return this.discussion.createReply(req.user, matchId, body);
  }
}
