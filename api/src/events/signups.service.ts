import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import { buildAnonymousSignupResponse } from './signup-response.helpers';
import {
  getRoster as getRosterHelper,
  getRosterWithAssignments as getRosterWithAssignmentsHelper,
} from './signup-roster.helpers';
import { performSignup, findEventOrThrow } from './signup-core.helpers';
import {
  updateSignupStatus,
  confirmSignupFlow,
} from './signup-confirm.helpers';
import {
  executeDiscordSignupTx,
  findLinkedUserSignup,
  findAnonymousDiscordSignup,
  cancelByDiscordUser as cancelByDiscordUserHelper,
} from './signup-discord.helpers';
import { cancelSignup } from './signup-cancel.helpers';
import { updateRoster as updateRosterHelper } from './signup-roster-update.helpers';
import { promoteFromBench as promoteFromBenchHelper } from './signup-bench-promote.helpers';
import {
  selfUnassign as selfUnassignHelper,
  adminRemoveSignup as adminRemoveHelper,
} from './signup-management.helpers';
import type {
  SignupResponseDto,
  EventRosterDto,
  CreateSignupDto,
  ConfirmSignupDto,
  UpdateRosterDto,
  RosterWithAssignments,
  CreateDiscordSignupDto,
  UpdateSignupStatusDto,
} from '@raid-ledger/contract';

@Injectable()
export class SignupsService {
  private readonly logger = new Logger(SignupsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private notificationService: NotificationService,
    private rosterNotificationBuffer: RosterNotificationBufferService,
    private benchPromotionService: BenchPromotionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async signup(
    eventId: number,
    userId: number,
    dto?: CreateSignupDto,
  ): Promise<SignupResponseDto> {
    const result = await performSignup(
      this.db,
      eventId,
      userId,
      dto,
      this.benchPromotionService,
    );
    if (!result.isDuplicate) {
      this.emit(SIGNUP_EVENTS.CREATED, {
        eventId,
        userId,
        signupId: result.signup.id,
        action: 'signup_created',
      });
      this.rosterNotificationBuffer.bufferJoin(eventId, userId);
    }
    return result.response;
  }

  async signupDiscord(
    eventId: number,
    dto: CreateDiscordSignupDto,
  ): Promise<SignupResponseDto> {
    const event = await findEventOrThrow(this.db, eventId);
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, dto.discordUserId))
      .limit(1);
    if (linkedUser)
      return this.signup(eventId, linkedUser.id, {
        preferredRoles: dto.preferredRoles,
        slotRole: dto.role,
      });

    const result = await executeDiscordSignupTx(
      this.db,
      eventId,
      event,
      dto,
      this.benchPromotionService,
    );
    this.emit(SIGNUP_EVENTS.CREATED, {
      eventId,
      signupId: result.id,
      action: 'discord_signup_created',
    });
    return buildAnonymousSignupResponse(result);
  }

  async updateStatus(
    eventId: number,
    signupIdentifier: { userId?: number; discordUserId?: string },
    dto: UpdateSignupStatusDto,
  ): Promise<SignupResponseDto> {
    const { updated, response } = await updateSignupStatus(
      this.db,
      eventId,
      signupIdentifier,
      dto,
      this.benchPromotionService,
    );
    this.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: updated.userId,
      signupId: updated.id,
      action: `status_changed_to_${dto.status}`,
    });
    return response;
  }

  async findByDiscordUser(
    eventId: number,
    discordUserId: string,
  ): Promise<SignupResponseDto | null> {
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);
    if (linkedUser) return findLinkedUserSignup(this.db, eventId, linkedUser);
    return findAnonymousDiscordSignup(this.db, eventId, discordUserId);
  }

  async cancelByDiscordUser(
    eventId: number,
    discordUserId: string,
  ): Promise<void> {
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);
    if (linkedUser) return this.cancel(eventId, linkedUser.id);
    await cancelByDiscordUserHelper(
      this.db,
      eventId,
      discordUserId,
      this.eventEmitter,
    );
  }

  async claimAnonymousSignups(
    discordUserId: string,
    userId: number,
  ): Promise<number> {
    const result = await this.db
      .update(schema.eventSignups)
      .set({ userId })
      .where(
        and(
          eq(schema.eventSignups.discordUserId, discordUserId),
          isNull(schema.eventSignups.userId),
        ),
      )
      .returning();
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
    const response = await confirmSignupFlow(
      this.db,
      eventId,
      signupId,
      userId,
      dto,
    );
    this.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId,
      signupId,
      action: 'signup_confirmed',
    });
    return response;
  }

  async cancel(eventId: number, userId: number): Promise<void> {
    await cancelSignup(
      this.db,
      eventId,
      userId,
      this.benchPromotionService,
      this.eventEmitter,
      (data) => this.rosterNotificationBuffer.bufferLeave(data),
    );
  }

  async getRoster(eventId: number): Promise<EventRosterDto> {
    return getRosterHelper(this.db, eventId);
  }

  async updateRoster(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: UpdateRosterDto,
  ): Promise<RosterWithAssignments> {
    await updateRosterHelper(
      this.db,
      eventId,
      userId,
      isAdmin,
      dto,
      this.notificationService,
      this.benchPromotionService,
      this.eventEmitter,
    );
    return this.getRosterWithAssignments(eventId);
  }

  async getRosterWithAssignments(
    eventId: number,
  ): Promise<RosterWithAssignments> {
    return getRosterWithAssignmentsHelper(this.db, eventId);
  }

  async selfUnassign(
    eventId: number,
    userId: number,
  ): Promise<RosterWithAssignments> {
    await selfUnassignHelper(
      this.db,
      eventId,
      userId,
      this.benchPromotionService,
      this.rosterNotificationBuffer,
      this.eventEmitter,
    );
    return this.getRosterWithAssignments(eventId);
  }

  async adminRemoveSignup(
    eventId: number,
    signupId: number,
    requesterId: number,
    isAdmin: boolean,
  ): Promise<void> {
    await adminRemoveHelper(
      this.db,
      eventId,
      signupId,
      requesterId,
      isAdmin,
      this.notificationService,
      this.benchPromotionService,
      this.eventEmitter,
    );
  }

  async promoteFromBench(
    eventId: number,
    signupId: number,
  ): Promise<{
    role: string;
    position: number;
    username: string;
    chainMoves?: string[];
    warning?: string;
  } | null> {
    return promoteFromBenchHelper(
      this.db,
      eventId,
      signupId,
      this.benchPromotionService,
    );
  }

  private emit(eventName: string, payload: SignupEventPayload): void {
    this.eventEmitter.emit(eventName, payload);
  }
}
