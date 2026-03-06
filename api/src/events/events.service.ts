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
  buildLifecyclePayload,
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
  insertRecurringEvents,
  insertSingleEvent,
  resolveRecurrenceGroupId,
} from './event-create.helpers';
import {
  findExistingEvent,
  assertCanUpdate,
  buildUpdateData,
} from './event-update.helpers';
import {
  findUserByDiscordId,
  assertNotSignedUp,
  getInviterUsername,
  emitMemberInvite,
} from './event-invite.helpers';
import { findOneEvent, findEventsByIds } from './event-find.helpers';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly availabilityService: AvailabilityService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
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
    if (dto.recurrence) {
      return this.createRecurring(
        dto,
        baseValues,
        startTime,
        durationMs,
        creatorId,
      );
    }
    return this.createSingle(baseValues, startTime, endTime, creatorId);
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
    this.logger.log(`Event updated: ${id} by user ${userId}`);
    const updated = await this.findOne(id);
    this.emitEventLifecycle(APP_EVENT_EVENTS.UPDATED, updated);
    return updated;
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
    this.logger.log(`Event cancelled: ${eventId} by user ${userId}`);
    const cancelled = await this.findOne(eventId);
    this.emitEventLifecycle(APP_EVENT_EVENTS.CANCELLED, cancelled);
    return cancelled;
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
    await rescheduleEvent(
      this.db,
      this.notificationService,
      eventId,
      userId,
      isAdmin,
      dto,
    );
    this.logger.log(`Event rescheduled: ${eventId} by user ${userId}`);
    const rescheduled = await this.findOne(eventId);
    this.emitEventLifecycle(APP_EVENT_EVENTS.UPDATED, rescheduled);
    return rescheduled;
  }

  /** Invites a registered member to an event via Discord ID. */
  async inviteMember(
    eventId: number,
    inviterId: number,
    isAdmin: boolean,
    discordId: string,
  ): Promise<{ message: string }> {
    const event = await this.findOne(eventId);
    const targetUser = await findUserByDiscordId(this.db, discordId);
    await assertNotSignedUp(this.db, eventId, targetUser);
    const inviterName = await getInviterUsername(this.db, inviterId);
    await emitMemberInvite(
      this.notificationService,
      this.eventEmitter,
      event,
      eventId,
      targetUser,
      inviterName,
      discordId,
    );
    this.logger.log(
      `User ${inviterId} invited member ${targetUser.id} (${targetUser.username}) to event ${eventId}`,
    );
    return { message: `Invite sent to ${targetUser.username}` };
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

  private async createRecurring(
    dto: CreateEventDto,
    baseValues: Record<string, unknown>,
    startTime: Date,
    durationMs: number,
    creatorId: number,
  ): Promise<EventResponseDto & { allEventIds: number[] }> {
    const events = await insertRecurringEvents(
      this.db,
      dto,
      baseValues,
      startTime,
      durationMs,
    );
    this.logger.log(
      `Recurring event: ${events.length} instances by user ${creatorId}`,
    );
    const allResponses = await this.findByIds(events.map((e) => e.id));
    for (const r of allResponses)
      this.emitEventLifecycle(APP_EVENT_EVENTS.CREATED, r);
    const first =
      allResponses.find((r) => r.id === events[0].id) ?? allResponses[0];
    return { ...first, allEventIds: events.map((e) => e.id) };
  }

  private async createSingle(
    baseValues: Record<string, unknown>,
    startTime: Date,
    endTime: Date,
    creatorId: number,
  ): Promise<EventResponseDto> {
    const event = await insertSingleEvent(
      this.db,
      baseValues,
      startTime,
      endTime,
    );
    this.logger.log(`Event created: ${event.id} by user ${creatorId}`);
    const created = await this.findOne(event.id);
    this.emitEventLifecycle(APP_EVENT_EVENTS.CREATED, created);
    return created;
  }

  private emitEventLifecycle(
    eventName: string,
    eventResponse: EventResponseDto,
  ): void {
    this.eventEmitter.emit(eventName, buildLifecyclePayload(eventResponse));
  }
}
