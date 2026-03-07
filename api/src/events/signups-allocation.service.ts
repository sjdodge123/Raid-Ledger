/**
 * Sub-service for auto-allocation, promotion, and tentative displacement.
 * Extracted from SignupsService for file size compliance (ROK-719).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { BenchPromotionService } from './bench-promotion.service';
import type {
  ExecuteDisplacementParams,
  DisplacedNotificationParams,
  PromoteMmoParams,
} from './signups.service.types';
import * as promoH from './signups-promotion.helpers';
import * as tentH from './signups-tentative.helpers';
import * as notifH from './signups-notification.helpers';
import * as allocH from './signups-auto-allocate.helpers';
import {
  type PromotionResult,
  buildPromotionWarnings,
} from './signups-allocation.helpers';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class SignupsAllocationService {
  private readonly logger = new Logger(SignupsAllocationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private notificationService: NotificationService,
    private benchPromotionService: BenchPromotionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async autoAllocateSignup(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    newSignupId: number,
    slotConfig: Record<string, unknown> | null,
  ): Promise<void> {
    await allocH.runAutoAllocation(
      tx,
      eventId,
      newSignupId,
      slotConfig,
      this.logger,
      (e, r, p) => this.benchPromotionService.cancelPromotion(e, r, p),
      (p) => this.executeDisplacement(p),
    );
  }

  async promoteFromBench(
    eventId: number,
    signupId: number,
  ): Promise<PromotionResult | null> {
    return this.db.transaction((tx) =>
      this.promoteFromBenchTx(tx, eventId, signupId),
    );
  }

  async reslotTentativePlayer(
    eventId: number,
    vacatedRole: string,
    vacatedPosition: number,
  ): Promise<void> {
    const reslottedSignupId = await this.db.transaction((tx) =>
      tentH.reslotTentativeTx(tx, eventId, vacatedRole, vacatedPosition),
    );
    if (!reslottedSignupId) return;
    this.logger.log(
      `ROK-459: Reslotted tentative signup ${reslottedSignupId} to ${vacatedRole} slot ${vacatedPosition}`,
    );
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      signupId: reslottedSignupId,
      action: 'tentative_reslotted',
    });
  }

  async checkTentativeDisplacement(
    eventId: number,
    tentativeSignupId: number,
  ): Promise<void> {
    const role = await tentH.getTentativeAssignmentRole(
      this.db,
      eventId,
      tentativeSignupId,
    );
    if (!role) return;
    const candidate = await tentH.findConfirmedCandidateForRole(
      this.db,
      eventId,
      role,
    );
    if (!candidate) return;
    const slotConfig = await tentH.fetchMmoSlotConfig(this.db, eventId);
    if (!slotConfig) return;
    await this.db.transaction((tx) =>
      this.autoAllocateSignup(tx, eventId, candidate.id, slotConfig),
    );
    this.logger.log(
      `ROK-459: Triggered displacement check after signup ${tentativeSignupId} went tentative — candidate ${candidate.id}`,
    );
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      signupId: tentativeSignupId,
      action: 'tentative_displacement_check',
    });
  }

  private async promoteFromBenchTx(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
  ): Promise<PromotionResult | null> {
    const slotConfig = await promoH.fetchSlotConfig(tx, eventId);
    if (!slotConfig) return null;
    const signup = await promoH.fetchPromotionSignup(tx, signupId);
    if (!signup) return null;
    const username = await promoH.resolveSignupUsername(tx, signup.userId);
    if (slotConfig.type !== 'mmo')
      return promoH.promoteGenericSlot(
        tx,
        eventId,
        signupId,
        slotConfig,
        username,
      );
    return this.promoteMmoSlot({
      tx,
      eventId,
      signupId,
      slotConfig,
      signup,
      username,
    });
  }

  private async promoteMmoSlot(
    p: PromoteMmoParams,
  ): Promise<PromotionResult | null> {
    const { tx, eventId, signupId, signup, username } = p;
    const before = await promoH.snapshotNonBenchAssignments(tx, eventId);
    await promoH.deleteBenchAssignment(tx, eventId, signupId);
    await this.autoAllocateSignup(tx, eventId, signupId, p.slotConfig);
    const na = await promoH.fetchCurrentAssignment(tx, eventId, signupId);
    if (!na || na.role === 'bench')
      return promoH.handleFailedPromotion(tx, eventId, signupId, na, username);
    const after = await promoH.snapshotNonBenchAssignments(tx, eventId);
    const chainMoves = await promoH.detectChainMoves(
      tx,
      before,
      after,
      signupId,
    );
    const warnings = buildPromotionWarnings(
      username,
      signup.preferredRoles,
      na.role,
      chainMoves,
    );
    return {
      role: na.role ?? 'bench',
      position: na.position,
      username,
      chainMoves: chainMoves.map(
        (m) => `${m.username}: ${m.fromRole} → ${m.toRole}`,
      ),
      warning: warnings.length > 0 ? warnings.join('\n') : undefined,
    };
  }

  private async executeDisplacement(
    p: ExecuteDisplacementParams,
  ): Promise<boolean> {
    const rearrangedToRole = await tentH.tryRearrangeVictim(
      {
        tx: p.tx,
        victim: p.victim,
        displacedRole: p.role,
        currentAssignments: p.currentAssignments,
        roleCapacity: p.roleCapacity,
        occupiedPositions: p.occupiedPositions,
        findPos: p.findPos,
        signupById: p.signupById,
      },
      this.logger,
    );
    if (!rearrangedToRole)
      await tentH.removeVictimAssignment(
        p.tx,
        p.victim,
        p.role,
        p.occupiedPositions,
        this.logger,
      );
    const pos = rearrangedToRole ? p.findPos(p.role) : p.victim.position;
    await allocH.insertAndConfirmSlot(
      p.tx,
      p.eventId,
      p.newSignupId,
      p.role,
      pos,
    );
    p.occupiedPositions[p.role]?.add(pos);
    this.logger.log(
      `ROK-459: Auto-allocated confirmed signup ${p.newSignupId} to ${p.role} slot ${pos} (tentative displacement)`,
    );
    await this.benchPromotionService.cancelPromotion(p.eventId, p.role, pos);
    this.fireDisplacedNotification({
      tx: p.tx,
      eventId: p.eventId,
      victimSignupId: p.victim.signupId,
      role: p.role,
      rearrangedToRole,
    });
    return true;
  }

  private fireDisplacedNotification(p: DisplacedNotificationParams) {
    tentH
      .sendDisplacedNotification(p, this.notificationService, (eId) =>
        notifH.fetchNotificationContext(this.notificationService, eId),
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to notify displaced tentative player: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
  }
}
