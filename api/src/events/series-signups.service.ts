/**
 * Series signup (ROK-1728): join a recurring series in one click, leave it,
 * and preview it. `SignupsService` is called, never edited (D2).
 */
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  JoinSeriesDto,
  JoinSeriesResponseDto,
  LeaveSeriesResponseDto,
  SeriesSignupStateDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SignupsService } from './signups.service';
import {
  assertEventAcceptingSignups,
  verifyCharacterOwnership,
} from './signups-cancel.helpers';
import {
  attachSignups,
  clearFutureTagsForMemberships,
  endMembership,
  findActiveMembership,
  type SeriesSignupRow,
} from './series-signups.queries';
import {
  buildSeriesState,
  toSeriesSignupDto,
  type ClassifiedNights,
} from './series-signups-plan.helpers';
import {
  assertEligibleUser,
  insertMembershipOrConflict,
  loadSeriesAnchor,
  materializeNights,
  planNights,
  SERIES_ERRORS,
  type MaterializeMembership,
  type SeriesAnchor,
} from './series-signups-join.helpers';
import { cancelTaggedNights } from './series-signups-lifecycle.helpers';

@Injectable()
export class SeriesSignupsService {
  private readonly logger = new Logger(SeriesSignupsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly signupsService: SignupsService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Preview / member state for the series from `eventId` forward. */
  async getState(
    eventId: number,
    userId: number,
  ): Promise<SeriesSignupStateDto> {
    const anchor = await loadSeriesAnchor(this.db, eventId);
    const membership = await findActiveMembership(
      this.db,
      anchor.groupId,
      userId,
    );
    const { nights, classified } = await planNights(
      this.db,
      anchor,
      userId,
      membership?.id,
      new Date(),
    );
    return buildSeriesState(nights, classified, membership);
  }

  /**
   * Joins the series from the clicked occurrence forward (OQ-9): attaches
   * active rows in place, creates missing nights, never touches inactive ones.
   */
  async join(
    eventId: number,
    userId: number,
    dto: JoinSeriesDto,
  ): Promise<JoinSeriesResponseDto> {
    await assertEligibleUser(this.db, userId);
    const anchor = await loadSeriesAnchor(this.db, eventId);
    assertEventAcceptingSignups(anchor.event);
    if (await findActiveMembership(this.db, anchor.groupId, userId))
      throw new ConflictException(SERIES_ERRORS.ALREADY_MEMBER);
    if (dto.characterId)
      await verifyCharacterOwnership(this.db, dto.characterId, userId);
    const { classified } = await planNights(
      this.db,
      anchor,
      userId,
      undefined,
      new Date(),
    );
    if (classified.attach.length + classified.create.length === 0)
      throw new ConflictException(SERIES_ERRORS.NO_NIGHTS);
    const membership = await insertMembershipOrConflict(this.db, {
      groupId: anchor.groupId,
      userId,
      characterId: dto.characterId ?? null,
      preferredRoles: dto.preferredRoles ?? null,
    });
    return this.fillMembership(anchor, userId, dto, membership, classified);
  }

  /** Attach + materialize + audit for a freshly inserted membership. */
  private async fillMembership(
    anchor: SeriesAnchor,
    userId: number,
    dto: JoinSeriesDto,
    membership: SeriesSignupRow,
    classified: ClassifiedNights,
  ): Promise<JoinSeriesResponseDto> {
    const applied = await this.applyPlan(userId, dto, membership, classified);
    await this.logJoined(
      anchor.event.id,
      userId,
      membership.id,
      applied.attachedEventIds.length + applied.createdEventIds.length,
    );
    return {
      membership: toSeriesSignupDto(membership),
      ...applied,
      keptEventIds: classified.keep.map((r) => r.eventId),
    };
  }

  /** Attaches the active rows in place, then creates the missing nights. */
  private async applyPlan(
    userId: number,
    dto: JoinSeriesDto,
    membership: MaterializeMembership,
    classified: ClassifiedNights,
  ): Promise<Omit<JoinSeriesResponseDto, 'membership' | 'keptEventIds'>> {
    const attachedEventIds = await attachSignups(
      this.db,
      classified.attach.map((r) => r.id),
      membership.id,
    );
    const materialized = await materializeNights(
      { db: this.db, signups: this.signupsService },
      classified.create,
      userId,
      membership,
      dto,
    );
    return { attachedEventIds, ...materialized };
  }

  /** Audits a join on the anchor event (Q8: per-night `signup_added` too). */
  private async logJoined(
    anchorEventId: number,
    userId: number,
    seriesSignupId: number,
    nights: number,
  ): Promise<void> {
    await this.activityLog.log(
      'event',
      anchorEventId,
      'series_joined',
      userId,
      {
        seriesSignupId,
        nights,
      },
    );
  }

  /**
   * Leaves the series: membership `left`, cancels the future active nights
   * it tagged (23h rule per night), untags every future row it tagged.
   */
  async leave(
    eventId: number,
    userId: number,
  ): Promise<LeaveSeriesResponseDto> {
    const anchor = await loadSeriesAnchor(this.db, eventId);
    const active = await findActiveMembership(this.db, anchor.groupId, userId);
    const ended = active
      ? await endMembership(this.db, active.id, 'left', 'user_left')
      : undefined;
    if (!ended) throw new NotFoundException(SERIES_ERRORS.NOT_MEMBER);
    const now = new Date();
    const cancelled = await cancelTaggedNights(
      { db: this.db, signups: this.signupsService, logger: this.logger },
      ended.id,
      userId,
      now,
    );
    await clearFutureTagsForMemberships(this.db, [ended.id], now);
    await this.activityLog.log(
      'event',
      anchor.event.id,
      'series_left',
      userId,
      {
        seriesSignupId: ended.id,
        cancelled: cancelled.cancelledEventIds.length,
      },
    );
    return { membership: toSeriesSignupDto(ended), ...cancelled };
  }
}
