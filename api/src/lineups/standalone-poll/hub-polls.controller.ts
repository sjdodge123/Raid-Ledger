import {
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequest } from '../../auth/types';
import { isOperatorOrAdmin } from '../../events/controller.helpers';
import {
  findActiveStandalonePolls,
  type ActiveStandalonePoll,
} from './standalone-poll-active.queries';

/**
 * ROK-1893 P3 (R10, §8d): the hub Events tab's "Open polls" — the open
 * scheduling polls tagged to a visible community hub, under the same
 * visibility rules as the site-wide active list (private polls only for their
 * creator, invitees and staff). A hidden / archived hub lists nothing.
 */
@Controller('hubs')
@UseGuards(AuthGuard('jwt'))
export class HubPollsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Get(':id/polls')
  async list(
    @Param('id', ParseIntPipe) hubId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<ActiveStandalonePoll[]> {
    const caller = {
      id: req.user.id,
      isAdmin: isOperatorOrAdmin(req.user.role),
    };
    return findActiveStandalonePolls(this.db, caller, { hubId });
  }
}
