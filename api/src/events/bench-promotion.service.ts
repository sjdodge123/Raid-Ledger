import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue, Job } from 'bullmq';
import { eq, and, asc } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';

export const BENCH_PROMOTION_QUEUE = 'bench-promotion';
export const PROMOTION_DELAY_MS = 5 * 60 * 1000; // 5 minutes

interface BenchPromotionJobData {
  eventId: number;
  vacatedRole: string;
  vacatedPosition: number;
}

/**
 * Service for scheduling bench-to-roster promotions (ROK-229).
 * Uses BullMQ delayed jobs to auto-promote the longest-waiting bench player
 * after a configurable grace window when a roster slot is vacated.
 */
@Injectable()
export class BenchPromotionService {
  private readonly logger = new Logger(BenchPromotionService.name);

  constructor(
    @InjectQueue(BENCH_PROMOTION_QUEUE) private queue: Queue,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Check if an event is eligible for auto-bench promotion.
   * Eligible: autoUnbench is true AND event is NOT MMO type.
   */
  async isEligible(eventId: number): Promise<boolean> {
    const [event] = await this.db
      .select({
        autoUnbench: schema.events.autoUnbench,
        slotConfig: schema.events.slotConfig,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) return false;
    if (!event.autoUnbench) return false;

    // MMO events use role-based slots — don't auto-promote across roles
    if (event.slotConfig) {
      const config = event.slotConfig as Record<string, unknown>;
      if (config.type === 'mmo') return false;
    }

    return true;
  }

  /**
   * Schedule a delayed promotion job for a vacated slot.
   * The job fires after PROMOTION_DELAY_MS to give the organizer time to
   * manually fill the slot before auto-promotion kicks in.
   */
  async schedulePromotion(
    eventId: number,
    vacatedRole: string,
    vacatedPosition: number,
  ): Promise<void> {
    const jobId = `promote-${eventId}-${vacatedRole}-${vacatedPosition}`;
    await this.queue.add(
      'promote',
      {
        eventId,
        vacatedRole,
        vacatedPosition,
      } satisfies BenchPromotionJobData,
      {
        jobId,
        delay: PROMOTION_DELAY_MS,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    this.logger.log(
      `Scheduled bench promotion for event ${eventId} slot ${vacatedRole}:${vacatedPosition}`,
    );
  }

  /**
   * Cancel a pending promotion job (e.g. when the slot is manually filled).
   */
  async cancelPromotion(
    eventId: number,
    vacatedRole: string,
    vacatedPosition: number,
  ): Promise<void> {
    const jobId = `promote-${eventId}-${vacatedRole}-${vacatedPosition}`;
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
      this.logger.log(`Cancelled bench promotion job ${jobId}`);
    }
  }
}

/**
 * BullMQ processor that executes bench promotions (ROK-229).
 * Runs after the grace delay, verifying the slot is still empty
 * before moving the longest-waiting bench player into it.
 */
@Processor(BENCH_PROMOTION_QUEUE)
export class BenchPromotionProcessor extends WorkerHost {
  private readonly logger = new Logger(BenchPromotionProcessor.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<BenchPromotionJobData>): Promise<void> {
    const { eventId, vacatedRole, vacatedPosition } = job.data;

    // 1. Verify event exists and autoUnbench is still enabled
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event || !event.autoUnbench) return;

    // 2. Check the slot is still empty
    const [existing] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, vacatedRole),
          eq(schema.rosterAssignments.position, vacatedPosition),
        ),
      )
      .limit(1);

    if (existing) return; // Slot was manually filled during grace window

    // 3. Find the longest-waiting bench player (FIFO)
    const benchPlayers = await this.db
      .select({
        assignmentId: schema.rosterAssignments.id,
        signupId: schema.rosterAssignments.signupId,
        userId: schema.eventSignups.userId,
      })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, 'bench'),
        ),
      )
      .orderBy(asc(schema.eventSignups.signedUpAt))
      .limit(1);

    if (benchPlayers.length === 0) return;

    const benchPlayer = benchPlayers[0];

    // 4. Move bench player to the vacated slot
    await this.db
      .update(schema.rosterAssignments)
      .set({ role: vacatedRole, position: vacatedPosition })
      .where(eq(schema.rosterAssignments.id, benchPlayer.assignmentId));

    this.logger.log(
      `Promoted bench player (signup ${benchPlayer.signupId}) to ${vacatedRole}:${vacatedPosition} for event ${eventId}`,
    );

    // 5. Notify the promoted player (only RL members, not anonymous Discord users)
    if (benchPlayer.userId) {
      await this.notificationService.create({
        userId: benchPlayer.userId,
        type: 'bench_promoted',
        title: 'Promoted from Bench!',
        message: `A slot opened up in "${event.title}" and you've been moved from the bench to the roster!`,
        payload: { eventId, role: vacatedRole, position: vacatedPosition },
      });
    }

    // 6. Emit signup event so Discord embed is re-synced (ROK-458)
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: benchPlayer.userId,
      signupId: benchPlayer.signupId,
      action: 'bench_promoted',
    } satisfies SignupEventPayload);
  }
}
