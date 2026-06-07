import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Inject,
  Query,
  Logger,
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
  dryRunNameDedup,
  mergeNameDuplicates,
  type NameDedupCommitResult,
  type NameDedupDryRunResult,
} from '../igdb/igdb-dedup-cleanup.helpers';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import {
  recoverOrphanScheduledEvents,
  type RecoveryResult,
} from '../discord-bot/services/scheduled-event.recovery';

@RateLimit('admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly queueHealth: QueueHealthService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly discordClient: DiscordBotClientService,
    private readonly settingsService: SettingsService,
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

  /**
   * Admin tool (ROK-1113): merge game rows whose canonical names normalize to the
   * same value (e.g., "Slay the Spire 2" vs "Slay the Spire II"). Defaults to
   * dry-run; pass `?dryRun=false` to commit.
   */
  @Post('games/dedup-cleanup-by-name')
  @HttpCode(HttpStatus.OK)
  async dedupCleanupByName(
    @Query('dryRun') dryRunParam?: string,
  ): Promise<NameDedupDryRunResult | NameDedupCommitResult> {
    const dryRun = dryRunParam !== 'false';
    if (dryRun) return dryRunNameDedup(this.db);
    return mergeNameDuplicates(this.db);
  }

  /**
   * Operator recovery for the ROK-1347 orphan-SE freeze: delete RL-created
   * duplicate Discord scheduled events that pin the guild at its 100-SE cap.
   * Defaults to dry-run; pass `?dryRun=false` to execute. Never deletes
   * operator-owned SEs. Re-runnable until `reclaimableDuplicates` is empty.
   * ROK-1355: `?includeStale=true` additionally reclaims untracked SEs whose
   * description carries the configured CLIENT_URL `/events/<id>` fingerprint —
   * stale RL duplicates of already-ended events that the live-match pass can
   * never pair.
   */
  @Post('scheduled-events/recover-orphans')
  @HttpCode(HttpStatus.OK)
  async recoverOrphanScheduledEvents(
    @Query('dryRun') dryRunParam?: string,
    @Query('includeStale') includeStaleParam?: string,
  ): Promise<RecoveryResult> {
    const dryRun = dryRunParam !== 'false';
    const guild = this.discordClient.getGuild();
    if (!guild) {
      return {
        dryRun,
        guildSeCount: 0,
        rlBound: 0,
        reclaimableDuplicates: [],
        staleReclaimable: [],
        operatorOrphans: 0,
        deleted: 0,
        failures: [],
      };
    }
    const staleClientUrl =
      includeStaleParam === 'true'
        ? await this.settingsService.getClientUrl()
        : null;
    return recoverOrphanScheduledEvents(guild, this.db, this.logger, {
      dryRun,
      staleClientUrl,
    });
  }
}
