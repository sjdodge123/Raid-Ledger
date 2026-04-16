import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Inject,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import {
  QueueHealthService,
  QueueHealthStatus,
} from '../queue/queue-health.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type { AuthenticatedExpressRequest } from '../auth/types';
import {
  findDuplicateGames,
  mergeAndDeleteDuplicates,
} from '../igdb/igdb-dedup-cleanup.helpers';

@RateLimit('admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminController {
  constructor(
    private readonly queueHealth: QueueHealthService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Get('check')
  checkAccess(@Req() req: AuthenticatedExpressRequest) {
    return {
      message: 'Admin access granted',
      user: req.user,
    };
  }

  @Get('queues/health')
  async getQueueHealth(): Promise<{ queues: QueueHealthStatus[] }> {
    const queues = await this.queueHealth.getHealthStatus();
    return { queues };
  }

  /** One-time cleanup: find and merge duplicate game rows (ROK-1008). */
  @Post('games/dedup-cleanup')
  @HttpCode(HttpStatus.OK)
  async dedupCleanup(): Promise<{ merged: number; errors: string[] }> {
    const groups = await findDuplicateGames(this.db);
    return mergeAndDeleteDuplicates(this.db, groups);
  }
}
