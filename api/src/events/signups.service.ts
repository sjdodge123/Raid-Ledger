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
import { SignupsRosterService } from './signups-roster.service';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import type {
  SignupResponseDto,
  EventRosterDto,
  CreateSignupDto,
  ConfirmSignupDto,
  CreateDiscordSignupDto,
  UpdateSignupStatusDto,
  UpdateRosterDto,
  RosterWithAssignments,
  ConfirmationStatus,
} from '@raid-ledger/contract';
import type { PromotionResult } from './signups-allocation.helpers';
import * as discordH from './signups-discord.helpers';
import * as cancelH from './signups-cancel.helpers';
import * as rosterH from './signups-roster.helpers';
import * as rosterQH from './signups-roster-query.helpers';
import * as flowH from './signups-flow.helpers';
import * as discordSignupH from './signups-discord-signup.helpers';
import { ActivityLogService } from '../activity-log/activity-log.service';

/** Service for managing event signups (FR-006), character confirmation (ROK-131), and anonymous Discord signups (ROK-137). */
@Injectable()
export class SignupsService {
  private readonly logger = new Logger(SignupsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private notificationService: NotificationService,
    private rosterNotificationBuffer: RosterNotificationBufferService,
    private benchPromotionService: BenchPromotionService,
    private allocationService: SignupsAllocationService,
    private rosterService: SignupsRosterService,
    private readonly eventEmitter: EventEmitter2,
    private readonly activityLog: ActivityLogService,
  ) {}

  private get flowDeps(): flowH.FlowDeps {
    return {
      db: this.db,
      logger: this.logger,
      cancelPromotion: (e, r, p) =>
        this.benchPromotionService.cancelPromotion(e, r, p),
      autoAllocateSignup: (tx, eId, sId, sc) =>
        this.allocationService.autoAllocateSignup(tx, eId, sId, sc),
    };
  }

  async signup(
    eventId: number,
    userId: number,
    dto?: CreateSignupDto,
  ): Promise<SignupResponseDto> {
    const eventRow = await cancelH.fetchEventOrThrow(this.db, eventId);
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (dto?.characterId)
      await cancelH.verifyCharacterOwnership(this.db, dto.characterId, userId);
    const result = await this.db.transaction((tx) =>
      flowH.signupTxBody(this.flowDeps, {
        tx,
        eventRow,
        eventId,
        userId,
        dto,
        user,
      }),
    );
    cancelH.cleanupMatchingPugSlots(this.db, eventId, userId).catch((err) => {
      this.logger.warn(
        'Failed to cleanup PUG slots: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
    });
    if (result.isDuplicate) return result.response;
    this.emit(SIGNUP_EVENTS.CREATED, {
      eventId,
      userId,
      signupId: result.signup.id,
      action: 'signup_created',
    });
    this.rosterNotificationBuffer.bufferJoin(eventId, userId);
    void this.activityLog.log('event', eventId, 'signup_added', userId, {
      role: dto?.slotRole ?? dto?.preferredRoles?.[0] ?? null,
    });
    const character = dto?.characterId
      ? await cancelH.getCharacterById(this.db, dto.characterId)
      : null;
    return rosterH.buildSignupResponseDto(
      result.signup,
      user,
      character,
      result.assignedSlot ?? undefined,
    );
  }

  async signupDiscord(
    eventId: number,
    dto: CreateDiscordSignupDto,
  ): Promise<SignupResponseDto> {
    const linkedUser = await discordSignupH.findLinkedUserForDiscord(
      this.db,
      dto.discordUserId,
    );
    if (linkedUser)
      return this.signup(eventId, linkedUser.id, {
        preferredRoles: dto.preferredRoles,
        slotRole: dto.role,
      });
    const { response, signupId } = await discordSignupH.anonymousDiscordSignup(
      this.db,
      this.flowDeps,
      eventId,
      dto,
    );
    this.emit(SIGNUP_EVENTS.CREATED, {
      eventId,
      signupId,
      action: 'discord_signup_created',
    });
    return response;
  }

  async updateStatus(
    eventId: number,
    id: { userId?: number; discordUserId?: string },
    dto: UpdateSignupStatusDto,
  ): Promise<SignupResponseDto> {
    const signup = await cancelH.findSignupByIdentifier(this.db, eventId, id);
    const [updated] = await this.db
      .update(schema.eventSignups)
      .set({ status: dto.status })
      .where(eq(schema.eventSignups.id, signup.id))
      .returning();
    this.logger.log(
      `Signup ${signup.id} status updated to ${dto.status} for event ${eventId}`,
    );
    this.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: updated.userId,
      signupId: updated.id,
      action: `status_changed_to_${dto.status}`,
    });
    if (dto.status === 'tentative') {
      this.allocationService
        .checkTentativeDisplacement(eventId, signup.id)
        .catch((err: unknown) => {
          this.logger.warn(
            `ROK-459: Failed tentative displacement check: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        });
    }
    return discordH.buildStatusUpdateResponse(this.db, updated);
  }

  async findByDiscordUser(
    eventId: number,
    discordUserId: string,
  ): Promise<SignupResponseDto | null> {
    return discordH.findByDiscordUserFlow(this.db, eventId, discordUserId);
  }

  async cancelByDiscordUser(
    eventId: number,
    discordUserId: string,
  ): Promise<void> {
    const linkedUser = await discordH.findLinkedUser(this.db, discordUserId);
    if (linkedUser) return this.cancel(eventId, linkedUser.id);
    await discordH.cancelByDiscordUserFlow(
      this.db,
      eventId,
      discordUserId,
      this.logger,
      this.eventEmitter,
    );
  }

  async claimAnonymousSignups(
    discordUserId: string,
    userId: number,
  ): Promise<number> {
    const result = await discordH.claimAnonymousSignupsQuery(
      this.db,
      discordUserId,
      userId,
    );
    if (result.length > 0)
      this.logger.log(
        `Claimed ${result.length} anonymous signup(s) for Discord user ${discordUserId} → RL user ${userId}`,
      );
    return result.length;
  }

  async confirmSignup(
    eventId: number,
    signupId: number,
    userId: number,
    dto: ConfirmSignupDto,
  ): Promise<SignupResponseDto> {
    const signup = await cancelH.fetchAndVerifySignup(
      this.db,
      eventId,
      signupId,
      userId,
    );
    const character = await cancelH.verifyCharacterOwnership(
      this.db,
      dto.characterId,
      userId,
    );
    const newStatus: ConfirmationStatus =
      signup.confirmationStatus === 'pending' ? 'confirmed' : 'changed';
    const [updated] = await this.db
      .update(schema.eventSignups)
      .set({ characterId: dto.characterId, confirmationStatus: newStatus })
      .where(eq(schema.eventSignups.id, signupId))
      .returning();
    const user = await cancelH.fetchUserById(this.db, userId);
    this.logger.log(
      `User ${userId} confirmed signup ${signupId} with character ${dto.characterId}`,
    );
    this.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId,
      signupId,
      action: 'signup_confirmed',
    });
    return rosterH.buildSignupResponseDto(updated, user, character);
  }

  async cancel(eventId: number, userId: number): Promise<void> {
    await this.rosterService.cancel(eventId, userId);
    void this.activityLog.log('event', eventId, 'signup_cancelled', userId);
  }

  async selfUnassign(
    eventId: number,
    userId: number,
  ): Promise<RosterWithAssignments> {
    return this.rosterService.selfUnassign(eventId, userId, (eId) =>
      this.getRosterWithAssignments(eId),
    );
  }

  async adminRemoveSignup(
    eventId: number,
    signupId: number,
    requesterId: number,
    isAdmin: boolean,
  ): Promise<void> {
    return this.rosterService.adminRemoveSignup(
      eventId,
      signupId,
      requesterId,
      isAdmin,
    );
  }

  async updateRoster(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: UpdateRosterDto,
  ): Promise<RosterWithAssignments> {
    return this.rosterService.updateRoster(
      eventId,
      userId,
      isAdmin,
      dto,
      (eId) => this.getRosterWithAssignments(eId),
    );
  }

  async getRoster(eventId: number): Promise<EventRosterDto> {
    return rosterQH.buildRosterResponse(this.db, eventId);
  }

  async getRosterWithAssignments(
    eventId: number,
  ): Promise<RosterWithAssignments> {
    return rosterQH.buildRosterWithAssignments(this.db, eventId);
  }

  async promoteFromBench(
    eventId: number,
    signupId: number,
  ): Promise<PromotionResult | null> {
    return this.allocationService.promoteFromBench(eventId, signupId);
  }

  private emit(eventName: string, payload: SignupEventPayload): void {
    this.eventEmitter.emit(eventName, payload);
  }
}
