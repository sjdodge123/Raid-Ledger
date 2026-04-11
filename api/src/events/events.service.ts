import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CreateEventDto,
  UpdateEventDto,
  EventResponseDto,
  EventListResponseDto,
  EventListQueryDto,
  DashboardResponseDto,
  RosterAvailabilityResponse,
  AggregateGameTimeResponse,
  RescheduleEventDto,
  UserEventSignupsResponseDto,
  CancelEventDto,
} from '@raid-ledger/contract';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import type { EmbedEventData } from '../discord-bot/services/discord-embed.factory';
import {
  mapEventToResponse,
  buildEmbedEventData,
  getVariantContext,
} from './event-response.helpers';
import { queryEventList, queryUpcomingByUser } from './event-query.helpers';
import { assembleDashboard } from './event-dashboard-build.helpers';
import {
  queryRosterAvailability,
  queryAggregateGameTime,
} from './event-availability.helpers';
import {
  deleteEvent,
  cancelEvent,
  rescheduleEvent,
} from './event-lifecycle.helpers';
import {
  buildBaseValues,
  resolveRecurrenceGroupId,
} from './event-create.helpers';
import {
  createRecurringFlow,
  createSingleFlow,
  emitEventLifecycle,
} from './event-create-flow.helpers';
import {
  findExistingEvent,
  assertCanUpdate,
  buildUpdateData,
} from './event-update.helpers';
import { inviteMemberFlow } from './event-invite.helpers';
import { findOneEvent, findEventsByIds } from './event-find.helpers';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { enrichEventWithConflicts } from './event-conflict-enrich.helpers';
import { findConflictingEvents } from './event-conflict.helpers';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly availabilityService: AvailabilityService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Creates a single or recurring event. */
  async create(
    creatorId: number,
    dto: CreateEventDto,
  ): Promise<EventResponseDto & { allEventIds?: number[] }> {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    const durationMs = endTime.getTime() - startTime.getTime();
    const groupId = resolveRecurrenceGroupId(dto);
    const baseValues = buildBaseValues(creatorId, dto, groupId);
    const deps = this.createFlowDeps();
    if (dto.recurrence) {
      const result = await createRecurringFlow(
        deps,
        dto,
        baseValues,
        startTime,
        durationMs,
        creatorId,
      );
      for (const eventId of result.allEventIds ?? []) {
        this.activityLog
          .log('event', eventId, 'event_created', creatorId, {
            title: dto.title,
          })
          .catch((err) =>
            this.logger.warn(
              'Activity log failed for event %d: %s',
              eventId,
              err,
            ),
          );
      }
      return result;
    }
    const result = await createSingleFlow(
      deps,
      baseValues,
      startTime,
      endTime,
      creatorId,
    );
    await this.activityLog.log('event', result.id, 'event_created', creatorId, {
      title: dto.title,
    });
    return result;
  }

  /** Lists events with filtering and pagination. */
  async findAll(
    query: EventListQueryDto,
    authenticatedUserId?: number,
  ): Promise<EventListResponseDto> {
    return queryEventList(this.db, query, authenticatedUserId, (row, preview) =>
      mapEventToResponse(row, preview),
    );
  }

  /** Throws NotFoundException if the event does not exist. */
  async exists(id: number): Promise<void> {
    const [row] = await this.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Event with ID ${id} not found`);
  }

  /** Finds a single event by ID with creator and game data. */
  async findOne(id: number): Promise<EventResponseDto> {
    const row = await findOneEvent(this.db, id);
    return mapEventToResponse(row);
  }

  /** Finds a single event and enriches with conflict data for the user. */
  async findOneWithConflicts(id: number, userId: number | null): Promise<EventResponseDto> {
    return enrichEventWithConflicts(
      await this.findOne(id), userId, (p) => findConflictingEvents(this.db, p),
    );
  }

  /** Finds multiple events by IDs. */
  async findByIds(ids: number[]): Promise<EventResponseDto[]> {
    const rows = await findEventsByIds(this.db, ids);
    return rows.map((row) => mapEventToResponse(row));
  }

  /** Returns the dashboard view for the authenticated user. */
  async getMyDashboard(
    userId: number,
    isAdmin: boolean,
  ): Promise<DashboardResponseDto> {
    return assembleDashboard(this.db, userId, isAdmin);
  }

  /** Fetches upcoming events a user is signed up for. */
  async findUpcomingByUser(
    userId: number,
    limit = 6,
  ): Promise<UserEventSignupsResponseDto> {
    return queryUpcomingByUser(this.db, userId, limit, (row) =>
      mapEventToResponse(row),
    );
  }

  /** Updates an event's fields after ownership verification. */
  async update(
    id: number,
    userId: number,
    isAdmin: boolean,
    dto: UpdateEventDto,
  ): Promise<EventResponseDto> {
    const existing = await findExistingEvent(this.db, id);
    assertCanUpdate(existing, userId, isAdmin);
    const updateData = buildUpdateData(dto, existing);
    await this.db
      .update(schema.events)
      .set(updateData)
      .where(eq(schema.events.id, id));
    return this.postMutate(id, userId, 'updated', APP_EVENT_EVENTS.UPDATED);
  }

  /** Deletes an event after ownership verification. */
  async delete(id: number, userId: number, isAdmin: boolean): Promise<void> {
    await deleteEvent(this.db, this.eventEmitter, id, userId, isAdmin);
    this.logger.log(`Event deleted: ${id} by user ${userId}`);
  }

  /** Cancels an event and notifies signed-up users. */
  async cancel(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: CancelEventDto,
  ): Promise<EventResponseDto> {
    await cancelEvent(
      this.db,
      this.notificationService,
      eventId,
      userId,
      isAdmin,
      dto,
    );
    await this.activityLog.log('event', eventId, 'event_cancelled', userId, {
      reason: dto.reason ?? null,
    });
    return this.postMutate(
      eventId,
      userId,
      'cancelled',
      APP_EVENT_EVENTS.CANCELLED,
    );
  }

  /** Returns roster availability for an event's signed-up users. */
  async getRosterAvailability(
    eventId: number,
    from?: string,
    to?: string,
  ): Promise<RosterAvailabilityResponse> {
    const event = await this.findOne(eventId);
    return queryRosterAvailability(
      this.db,
      this.availabilityService,
      event,
      eventId,
      from,
      to,
    );
  }

  /** Returns aggregate game-time heatmap for an event's roster. */
  async getAggregateGameTime(
    eventId: number,
  ): Promise<AggregateGameTimeResponse> {
    await this.exists(eventId);
    return queryAggregateGameTime(this.db, eventId);
  }

  /** Reschedules an event and notifies participants. */
  async reschedule(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: RescheduleEventDto,
  ): Promise<EventResponseDto> {
    const eventBefore = await this.findOne(eventId);
    await rescheduleEvent(
      this.db,
      this.notificationService,
      eventId,
      userId,
      isAdmin,
      dto,
    );
    await this.activityLog.log('event', eventId, 'event_rescheduled', userId, {
      oldStart: eventBefore.startTime,
      newStart: dto.startTime,
    });
    return this.postMutate(
      eventId,
      userId,
      'rescheduled',
      APP_EVENT_EVENTS.UPDATED,
    );
  }

  /** Invites a registered member to an event via Discord ID. */
  async inviteMember(
    eventId: number,
    inviterId: number,
    isAdmin: boolean,
    discordId: string,
  ): Promise<{ message: string }> {
    const event = await this.findOne(eventId);
    const result = await inviteMemberFlow(
      this.db,
      this.notificationService,
      this.eventEmitter,
      event,
      eventId,
      inviterId,
      discordId,
    );
    this.logger.log(
      `User ${inviterId} invited ${result.targetUser.username} to event ${eventId}`,
    );
    return { message: result.message };
  }

  /** Builds embed data for Discord embed rendering. */
  async buildEmbedEventData(eventId: number): Promise<EmbedEventData> {
    const event = await this.findOne(eventId);
    return buildEmbedEventData(this.db, event, eventId);
  }

  /** Gets the dominant game variant and region for an event. */
  async getVariantContext(
    eventId: number,
  ): Promise<{ gameVariant: string | null; region: string | null }> {
    return getVariantContext(this.db, eventId);
  }

  /** Logs, re-fetches, and emits a lifecycle event after a mutation. */
  private async postMutate(
    eventId: number,
    userId: number,
    action: string,
    emitKey: string,
  ): Promise<EventResponseDto> {
    this.logger.log(`Event ${action}: ${eventId} by user ${userId}`);
    const event = await this.findOne(eventId);
    emitEventLifecycle(this.eventEmitter, emitKey, event);
    return event;
  }

  private createFlowDeps() {
    return {
      db: this.db,
      eventEmitter: this.eventEmitter,
      logger: this.logger,
      findByIds: (ids: number[]) => this.findByIds(ids),
      findOne: (id: number) => this.findOne(id),
    };
  }
}
