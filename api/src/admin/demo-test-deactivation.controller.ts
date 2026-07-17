/**
 * Demo/test-only endpoints for the deactivation pipeline (ROK-1260).
 *
 * All routes are DEMO_MODE only and admin-gated. They give the smoke
 * test deterministic fixtures + state probes for the 50278 → deactivate
 * end-to-end flow without piggy-backing on a real event lifecycle.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SkipThrottle } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { DiscordNotificationService } from '../notifications/discord-notification.service';
import {
  DISCORD_NOTIFICATION_QUEUE,
  type DiscordNotificationJobData,
} from '../notifications/discord-notification.constants';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestDeactivationController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    @InjectQueue(DISCORD_NOTIFICATION_QUEUE)
    private readonly discordQueue: Queue<DiscordNotificationJobData>,
  ) {
    // discord notification service injected indirectly via the queue + processor.
    void DiscordNotificationService;
  }

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const demoMode = await this.settingsService.getDemoMode();
    if (!demoMode) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /**
   * Seed a fresh user with a syntactically-valid Discord snowflake that
   * is NOT in the test guild. Provides a deterministic 50278 recipient.
   */
  @Post('seed-non-guild-user')
  @HttpCode(HttpStatus.OK)
  async seedNonGuildUser(): Promise<{ userId: number; discordId: string }> {
    await this.assertDemoMode();
    const snowflake = `9${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;
    const [user] = await this.db
      .insert(schema.users)
      .values({
        discordId: snowflake,
        username: `non-guild-${Date.now()}`,
        role: 'member',
      })
      .returning({ id: schema.users.id });
    return { userId: user.id, discordId: snowflake };
  }

  /**
   * Forcibly enqueue a Discord notification for the given user, bypassing
   * rate-limit/dedup so the smoke test always gets a job. Returns the
   * notificationId used for the job (also stable across attempts).
   */
  @Post('dispatch-discord-notification')
  @HttpCode(HttpStatus.OK)
  async dispatchDiscordNotification(
    @Body()
    body: {
      userId: number;
      type?: string;
      simulate?: 50278 | 50007 | 10013;
    },
  ): Promise<{ enqueued: boolean; notificationId: string }> {
    await this.assertDemoMode();
    const userId = Number(body?.userId);
    if (!userId) throw new BadRequestException('userId required');
    const [u] = await this.db
      .select({
        id: schema.users.id,
        discordId: schema.users.discordId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!u?.discordId) {
      throw new BadRequestException(
        `User ${userId} has no Discord ID — cannot dispatch`,
      );
    }
    const notificationId = `rok-1260-test-${Date.now()}-${userId}`;
    await this.discordQueue.add(
      'send-dm',
      {
        notificationId,
        userId: u.id,
        discordId: u.discordId,
        type: (body?.type as DiscordNotificationJobData['type']) ?? 'system',
        title: 'ROK-1260 smoke test',
        message: 'This DM is part of the ROK-1260 deactivation smoke test.',
        __simulateError: body?.simulate,
      },
      {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
        jobId: notificationId,
      },
    );
    return { enqueued: true, notificationId };
  }

  /** Read user state probe — `deactivated_at` + admin notification count. */
  @Get('user-state')
  async userState(@Query('userId') userIdParam?: string): Promise<{
    id: number;
    deactivatedAt: string | null;
    adminDeactivationNotificationCount: number;
  }> {
    await this.assertDemoMode();
    const userId = Number(userIdParam ?? '0');
    if (!userId) throw new BadRequestException('userId required');
    const [u] = await this.db
      .select({
        id: schema.users.id,
        deactivatedAt: schema.users.deactivatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!u) throw new BadRequestException(`User ${userId} not found`);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.type, 'user_deactivated_discord'),
          sql`(payload->>'deactivatedUserId')::int = ${userId}`,
        ),
      );
    return {
      id: u.id,
      deactivatedAt: u.deactivatedAt ? u.deactivatedAt.toISOString() : null,
      adminDeactivationNotificationCount: Number(count) || 0,
    };
  }

  /** Read BullMQ job state for a Discord notification by stable jobId/notificationId. */
  @Get('job-state')
  async jobState(@Query('notificationId') notificationId?: string): Promise<{
    state:
      'waiting' | 'active' | 'completed' | 'failed' | 'unknown' | 'delayed';
  }> {
    await this.assertDemoMode();
    if (!notificationId)
      throw new BadRequestException('notificationId required');
    const job = await this.discordQueue.getJob(notificationId);
    if (!job) return { state: 'unknown' };
    const state = (await job.getState()) as
      'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
    return { state };
  }
}
