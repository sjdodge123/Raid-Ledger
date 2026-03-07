/**
 * Sub-service for cancel, self-unassign, admin remove, and roster update operations.
 * Extracted from SignupsService for file size compliance (ROK-719).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import type {
  UpdateRosterDto,
  RosterWithAssignments,
} from '@raid-ledger/contract';
import * as cancelH from './signups-cancel.helpers';
import * as notifH from './signups-notification.helpers';
import * as rosterOpsH from './signups-roster-ops.helpers';

@Injectable()
export class SignupsRosterService {
  private readonly logger = new Logger(SignupsRosterService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private notificationService: NotificationService,
    private rosterNotificationBuffer: RosterNotificationBufferService,
    private benchPromotionService: BenchPromotionService,
    private allocationService: SignupsAllocationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async cancel(eventId: number, userId: number): Promise<void> {
    const signup = await cancelH.findActiveSignupForCancel(
      this.db,
      eventId,
      userId,
    );
    const cancelInfo = await cancelH.resolveCancelStatus(this.db, eventId);
    const assignment = await cancelH.findAssignmentForSignup(
      this.db,
      signup.id,
    );
    const notifyData = assignment
      ? await cancelH.gatherCancelNotifyData(this.db, eventId, userId)
      : null;
    await cancelH.executeCancelSignup(
      this.db,
      signup.id,
      assignment,
      cancelInfo.cancelStatus,
      cancelInfo.isGracefulDecline,
      cancelInfo.now,
    );
    this.logger.log(
      `User ${userId} canceled signup for event ${eventId} (${cancelInfo.cancelStatus})`,
    );
    this.emit(SIGNUP_EVENTS.DELETED, {
      eventId,
      userId,
      signupId: signup.id,
      action: 'signup_cancelled',
    });
    if (notifyData && assignment) {
      this.bufferLeave(eventId, userId, assignment, notifyData);
      await this.triggerBackfill(eventId, assignment);
    }
  }

  async selfUnassign(
    eventId: number,
    userId: number,
    getRosterWithAssignments: (
      eventId: number,
    ) => Promise<RosterWithAssignments>,
  ): Promise<RosterWithAssignments> {
    const { signup, assignment } = await rosterOpsH.findUserAssignment(
      this.db,
      eventId,
      userId,
    );
    const notifyData = await cancelH.gatherCancelNotifyData(
      this.db,
      eventId,
      userId,
    );
    await this.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.id, assignment.id));
    this.logger.log(
      `User ${userId} self-unassigned from ${assignment.role} slot for event ${eventId}`,
    );
    this.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId,
      signupId: signup.id,
      action: 'self_unassigned',
    });
    this.bufferLeave(eventId, userId, assignment, notifyData);
    if (assignment.role && assignment.role !== 'bench')
      await this.scheduleBackfill(
        eventId,
        assignment.role,
        assignment.position,
      );
    return getRosterWithAssignments(eventId);
  }

  async adminRemoveSignup(
    eventId: number,
    signupId: number,
    requesterId: number,
    isAdmin: boolean,
  ): Promise<void> {
    const { event, signup, assignment } = await rosterOpsH.adminRemoveCore(
      this.db,
      eventId,
      signupId,
      requesterId,
      isAdmin,
      this.logger,
    );
    this.emit(SIGNUP_EVENTS.DELETED, {
      eventId,
      userId: signup.userId,
      signupId: signup.id,
      action: 'admin_removed',
    });
    if (signup.userId)
      await rosterOpsH.notifyRemovedUser(
        this.notificationService,
        signup.userId,
        eventId,
        event.title,
        (eId) => notifH.fetchNotificationContext(this.notificationService, eId),
      );
    if (assignment?.role && assignment.role !== 'bench') {
      await this.scheduleBackfill(
        eventId,
        assignment.role,
        assignment.position,
      );
      this.allocationService
        .reslotTentativePlayer(eventId, assignment.role, assignment.position)
        .catch((err: unknown) => {
          this.logger.warn(
            `ROK-459: Failed tentative reslot (admin remove): ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        });
    }
  }

  async updateRoster(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: UpdateRosterDto,
    getRosterWithAssignments: (
      eventId: number,
    ) => Promise<RosterWithAssignments>,
  ): Promise<RosterWithAssignments> {
    const event = await cancelH.verifyAdminPermission(
      this.db,
      eventId,
      userId,
      isAdmin,
      'update roster',
    );
    const signupByUserId = await notifH.validateRosterAssignments(
      this.db,
      eventId,
      dto.assignments,
    );
    const oldRoleBySignupId = await notifH.captureOldAssignments(
      this.db,
      eventId,
    );
    await notifH.replaceRosterAssignments(
      this.db,
      eventId,
      dto.assignments,
      signupByUserId,
      this.benchPromotionService,
    );
    this.logger.log(
      `Roster updated for event ${eventId}: ${dto.assignments.length} assignments`,
    );
    this.emit(SIGNUP_EVENTS.UPDATED, { eventId, action: 'roster_updated' });
    rosterOpsH.fireRosterNotifications(
      this.notificationService,
      eventId,
      event.title,
      dto.assignments,
      signupByUserId,
      oldRoleBySignupId,
      (eId) => notifH.fetchNotificationContext(this.notificationService, eId),
      this.logger,
    );
    return getRosterWithAssignments(eventId);
  }

  private async triggerBackfill(
    eventId: number,
    assignment: typeof schema.rosterAssignments.$inferSelect,
  ) {
    if (!assignment.role || assignment.role === 'bench') return;
    await this.scheduleBackfill(eventId, assignment.role, assignment.position);
    this.allocationService
      .reslotTentativePlayer(eventId, assignment.role, assignment.position)
      .catch((err: unknown) => {
        this.logger.warn(
          `ROK-459: Failed tentative reslot: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
  }

  private bufferLeave(
    eventId: number,
    userId: number,
    assignment: typeof schema.rosterAssignments.$inferSelect,
    notifyData: {
      creatorId: number;
      eventTitle: string;
      displayName: string;
    },
  ) {
    this.rosterNotificationBuffer.bufferLeave({
      organizerId: notifyData.creatorId,
      eventId,
      eventTitle: notifyData.eventTitle,
      userId,
      displayName: notifyData.displayName,
      vacatedRole: assignment.role ?? 'assigned',
    });
  }

  private async scheduleBackfill(
    eventId: number,
    role: string,
    position: number,
  ) {
    if (await this.benchPromotionService.isEligible(eventId))
      await this.benchPromotionService.schedulePromotion(
        eventId,
        role,
        position,
      );
  }

  private emit(eventName: string, payload: SignupEventPayload): void {
    this.eventEmitter.emit(eventName, payload);
  }
}
