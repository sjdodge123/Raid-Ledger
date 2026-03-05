import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  eq,
  gte,
  lte,
  asc,
  desc,
  sql,
  and,
  inArray,
  ne,
} from 'drizzle-orm';
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
  UserWithAvailabilitySlots,
  AggregateGameTimeResponse,
  RescheduleEventDto,
  UserEventSignupsResponseDto,
  CancelEventDto,
} from '@raid-ledger/contract';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';
import {
  APP_EVENT_EVENTS,
  MEMBER_INVITE_EVENTS,
} from '../discord-bot/discord-bot.constants';
import type { MemberInviteCreatedPayload } from '../discord-bot/discord-bot.constants';
import type { EmbedEventData } from '../discord-bot/services/discord-embed.factory';
import { generateRecurringDates } from './recurrence.util';
import {
  mapEventToResponse,
  buildLifecyclePayload,
  getSignupsPreviewForEvents,
  buildEmbedEventData,
  getVariantContext,
} from './event-response.helpers';
import {
  queryDashboardData,
  queryUnconfirmedCounts,
  queryAssignmentCounts,
  queryAttendanceMetrics,
  buildDashboardEvents,
} from './event-dashboard.helpers';

/** Constants for events service */
const EVENTS_CONFIG = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

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

  async create(
    creatorId: number,
    dto: CreateEventDto,
  ): Promise<EventResponseDto & { allEventIds?: number[] }> {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    const durationMs = endTime.getTime() - startTime.getTime();

    const recurrenceGroupId = dto.recurrence ? randomUUID() : null;

    const baseValues = {
      title: dto.title,
      description: dto.description ?? null,
      gameId: dto.gameId ?? null,
      creatorId,
      slotConfig: dto.slotConfig ?? null,
      maxAttendees: dto.maxAttendees ?? null,
      autoUnbench: dto.autoUnbench ?? true,
      recurrenceGroupId,
      recurrenceRule: dto.recurrence ?? null,
      contentInstances: dto.contentInstances ?? null,
      reminder15min: dto.reminder15min ?? true,
      reminder1hour: dto.reminder1hour ?? false,
      reminder24hour: dto.reminder24hour ?? false,
    };

    if (dto.recurrence) {
      const instances = generateRecurringDates(
        startTime,
        dto.recurrence.frequency,
        new Date(dto.recurrence.until),
      );

      const allValues = instances.map((instanceStart) => ({
        ...baseValues,
        duration: [
          instanceStart,
          new Date(instanceStart.getTime() + durationMs),
        ] as [Date, Date],
      }));

      const events = await this.db
        .insert(schema.events)
        .values(allValues)
        .returning();

      this.logger.log(
        `Recurring event created: ${events.length} instances by user ${creatorId} (group ${recurrenceGroupId})`,
      );

      const allResponses = await this.findByIds(events.map((e) => e.id));
      for (const evtResponse of allResponses) {
        this.emitEventLifecycle(APP_EVENT_EVENTS.CREATED, evtResponse);
      }

      const response =
        allResponses.find((r) => r.id === events[0].id) ?? allResponses[0];
      return { ...response, allEventIds: events.map((e) => e.id) };
    }

    const [event] = await this.db
      .insert(schema.events)
      .values({ ...baseValues, duration: [startTime, endTime] })
      .returning();

    this.logger.log(`Event created: ${event.id} by user ${creatorId}`);

    const createdEvent = await this.findOne(event.id);
    this.emitEventLifecycle(APP_EVENT_EVENTS.CREATED, createdEvent);
    return createdEvent;
  }

  async findAll(
    query: EventListQueryDto,
    authenticatedUserId?: number,
  ): Promise<EventListResponseDto> {
    const page = query.page ?? 1;
    const limit = Math.min(
      query.limit ?? EVENTS_CONFIG.DEFAULT_PAGE_SIZE,
      EVENTS_CONFIG.MAX_PAGE_SIZE,
    );
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof gte>[] = [];

    if (query.includeCancelled !== 'true') {
      conditions.push(sql`${schema.events.cancelledAt} IS NULL`);
    }

    if (query.upcoming === 'true') {
      conditions.push(
        gte(
          sql`upper(${schema.events.duration})`,
          sql`${new Date().toISOString()}::timestamp`,
        ),
      );
    } else if (query.upcoming === 'false') {
      conditions.push(
        lte(
          sql`upper(${schema.events.duration})`,
          sql`${new Date().toISOString()}::timestamp`,
        ),
      );
    }

    if (query.startAfter) {
      conditions.push(
        gte(
          sql`lower(${schema.events.duration})`,
          sql`${query.startAfter}::timestamp`,
        ),
      );
    }

    if (query.endBefore) {
      conditions.push(
        lte(
          sql`lower(${schema.events.duration})`,
          sql`${query.endBefore}::timestamp`,
        ),
      );
    }

    if (query.gameId) {
      conditions.push(eq(schema.events.gameId, Number(query.gameId)));
    }

    if (query.creatorId) {
      const resolvedCreatorId =
        query.creatorId === 'me'
          ? authenticatedUserId
          : Number(query.creatorId);
      if (resolvedCreatorId) {
        conditions.push(eq(schema.events.creatorId, resolvedCreatorId));
      }
    }

    if (query.includeAdHoc === 'false') {
      conditions.push(eq(schema.events.isAdHoc, false));
    }

    if (query.signedUpAs && query.signedUpAs === 'me' && authenticatedUserId) {
      const signedUpEventIds = this.db
        .select({ eventId: schema.eventSignups.eventId })
        .from(schema.eventSignups)
        .where(
          and(
            eq(schema.eventSignups.userId, authenticatedUserId),
            ne(schema.eventSignups.status, 'roached_out'),
            ne(schema.eventSignups.status, 'departed'),
          ),
        );
      conditions.push(inArray(schema.events.id, signedUpEventIds));
    }

    const whereCondition =
      conditions.length > 0 ? and(...conditions) : undefined;

    const countQuery = this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events);

    const countResult = whereCondition
      ? await countQuery.where(whereCondition)
      : await countQuery;

    const total = Number(countResult[0].count);

    const signupCountSubquery = this.db
      .select({
        eventId: schema.eventSignups.eventId,
        count: sql<number>`count(*)`.as('signup_count'),
      })
      .from(schema.eventSignups)
      .where(
        and(
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'departed'),
          ne(schema.eventSignups.status, 'declined'),
        ),
      )
      .groupBy(schema.eventSignups.eventId)
      .as('signup_counts');

    let eventsQuery = this.db
      .select({
        events: schema.events,
        users: schema.users,
        games: schema.games,
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .leftJoin(
        signupCountSubquery,
        eq(schema.events.id, signupCountSubquery.eventId),
      )
      .$dynamic();

    if (whereCondition) {
      eventsQuery = eventsQuery.where(whereCondition);
    }

    const sortDirection = query.upcoming === 'false' ? desc : asc;
    const events = await eventsQuery
      .orderBy(sortDirection(sql`lower(${schema.events.duration})`))
      .limit(limit)
      .offset(offset);

    let signupsPreviewMap = new Map<
      number,
      {
        id: number;
        discordId: string;
        username: string;
        avatar: string | null;
        customAvatarUrl?: string | null;
        characters?: { gameId: number; avatarUrl: string | null }[];
      }[]
    >();
    if (query.includeSignups === 'true' && events.length > 0) {
      const eventIds = events.map((e) => e.events.id);
      signupsPreviewMap = await getSignupsPreviewForEvents(
        this.db,
        eventIds,
        5,
      );
    }

    const data = events.map((row) =>
      this.mapToResponse(row, signupsPreviewMap.get(row.events.id)),
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  async exists(id: number): Promise<void> {
    const [row] = await this.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .limit(1);

    if (!row) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
  }

  async findOne(id: number): Promise<EventResponseDto> {
    const results = await this.db
      .select({
        events: schema.events,
        users: schema.users,
        games: schema.games,
        signupCount: sql<number>`coalesce((
          SELECT count(*) FROM event_signups WHERE event_id = ${schema.events.id} AND status != 'roached_out' AND status != 'departed' AND status != 'declined'
        ), 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .where(eq(schema.events.id, id))
      .limit(1);

    if (results.length === 0) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    return this.mapToResponse(results[0]);
  }

  async findByIds(ids: number[]): Promise<EventResponseDto[]> {
    if (ids.length === 0) return [];

    const signupCountSubquery = this.db
      .select({
        eventId: schema.eventSignups.eventId,
        count: sql<number>`count(*)`.as('signup_count'),
      })
      .from(schema.eventSignups)
      .where(
        and(
          inArray(schema.eventSignups.eventId, ids),
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'departed'),
          ne(schema.eventSignups.status, 'declined'),
        ),
      )
      .groupBy(schema.eventSignups.eventId)
      .as('signup_counts');

    const results = await this.db
      .select({
        events: schema.events,
        users: schema.users,
        games: schema.games,
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .leftJoin(
        signupCountSubquery,
        eq(schema.events.id, signupCountSubquery.eventId),
      )
      .where(inArray(schema.events.id, ids));

    return results.map((row) => this.mapToResponse(row));
  }

  async getMyDashboard(
    userId: number,
    isAdmin: boolean,
  ): Promise<DashboardResponseDto> {
    const { events, eventIds } = await queryDashboardData(
      this.db,
      userId,
      isAdmin,
    );

    if (events.length === 0) {
      return {
        stats: {
          totalUpcomingEvents: 0,
          totalSignups: 0,
          averageFillRate: 0,
          eventsWithRosterGaps: 0,
        },
        events: [],
      };
    }

    const [unconfirmedMap, assignmentMap, attendance] = await Promise.all([
      queryUnconfirmedCounts(this.db, eventIds),
      queryAssignmentCounts(this.db, eventIds),
      queryAttendanceMetrics(this.db, userId, isAdmin),
    ]);

    const {
      dashboardEvents,
      totalSignups,
      averageFillRate,
      eventsWithRosterGaps,
    } = buildDashboardEvents(
      events,
      (row) => this.mapToResponse(row),
      assignmentMap,
      unconfirmedMap,
    );

    return {
      stats: {
        totalUpcomingEvents: events.length,
        totalSignups,
        averageFillRate,
        eventsWithRosterGaps,
        attendanceRate: attendance.attendanceRate,
        noShowRate: attendance.noShowRate,
      },
      events: dashboardEvents,
    };
  }

  async findUpcomingByUser(
    userId: number,
    limit = 6,
  ): Promise<UserEventSignupsResponseDto> {
    const now = new Date().toISOString();

    const signedUpEventIds = this.db
      .select({ eventId: schema.eventSignups.eventId })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.userId, userId),
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'departed'),
        ),
      );

    const conditions = [
      inArray(schema.events.id, signedUpEventIds),
      gte(sql`lower(${schema.events.duration})`, sql`${now}::timestamp`),
      sql`${schema.events.cancelledAt} IS NULL`,
    ];

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events)
      .where(and(...conditions));

    const total = Number(countResult[0].count);

    const signupCountSubquery = this.db
      .select({
        eventId: schema.eventSignups.eventId,
        count: sql<number>`count(*)`.as('signup_count'),
      })
      .from(schema.eventSignups)
      .where(
        and(
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'departed'),
          ne(schema.eventSignups.status, 'declined'),
        ),
      )
      .groupBy(schema.eventSignups.eventId)
      .as('signup_counts');

    const events = await this.db
      .select({
        events: schema.events,
        users: schema.users,
        games: schema.games,
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .leftJoin(
        signupCountSubquery,
        eq(schema.events.id, signupCountSubquery.eventId),
      )
      .where(and(...conditions))
      .orderBy(asc(sql`lower(${schema.events.duration})`))
      .limit(limit);

    const data = events.map((row) => this.mapToResponse(row));
    return { data, total };
  }

  async update(
    id: number,
    userId: number,
    isAdmin: boolean,
    dto: UpdateEventDto,
  ): Promise<EventResponseDto> {
    const existing = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    if (existing[0].creatorId !== userId && !isAdmin) {
      throw new ForbiddenException('You can only update your own events');
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.gameId !== undefined) updateData.gameId = dto.gameId ?? null;
    if (dto.slotConfig !== undefined) updateData.slotConfig = dto.slotConfig;
    if (dto.maxAttendees !== undefined)
      updateData.maxAttendees = dto.maxAttendees;
    if (dto.autoUnbench !== undefined) updateData.autoUnbench = dto.autoUnbench;
    if (dto.contentInstances !== undefined)
      updateData.contentInstances = dto.contentInstances;
    if (dto.reminder15min !== undefined)
      updateData.reminder15min = dto.reminder15min;
    if (dto.reminder1hour !== undefined)
      updateData.reminder1hour = dto.reminder1hour;
    if (dto.reminder24hour !== undefined)
      updateData.reminder24hour = dto.reminder24hour;

    if (dto.startTime || dto.endTime) {
      const currentDuration = existing[0].duration;
      const startTime = dto.startTime
        ? new Date(dto.startTime)
        : currentDuration[0];
      const endTime = dto.endTime ? new Date(dto.endTime) : currentDuration[1];

      if (startTime >= endTime) {
        throw new BadRequestException('Start time must be before end time');
      }
      updateData.duration = [startTime, endTime];
    }

    await this.db
      .update(schema.events)
      .set(updateData)
      .where(eq(schema.events.id, id));

    this.logger.log(`Event updated: ${id} by user ${userId}`);

    const updatedEvent = await this.findOne(id);
    this.emitEventLifecycle(APP_EVENT_EVENTS.UPDATED, updatedEvent);
    return updatedEvent;
  }

  async delete(id: number, userId: number, isAdmin: boolean): Promise<void> {
    const existing = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    if (existing[0].creatorId !== userId && !isAdmin) {
      throw new ForbiddenException('You can only delete your own events');
    }

    this.eventEmitter.emit(APP_EVENT_EVENTS.DELETED, { eventId: id });
    await this.db.delete(schema.events).where(eq(schema.events.id, id));
    this.logger.log(`Event deleted: ${id} by user ${userId}`);
  }

  async cancel(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: CancelEventDto,
  ): Promise<EventResponseDto> {
    const existing = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    if (existing[0].creatorId !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Only the event creator, operator, or admin can cancel this event',
      );
    }

    if (existing[0].cancelledAt) {
      throw new BadRequestException('This event has already been cancelled');
    }

    await this.db
      .update(schema.events)
      .set({
        cancelledAt: new Date(),
        cancellationReason: dto.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, eventId));

    this.logger.log(`Event cancelled: ${eventId} by user ${userId}`);

    const signups = await this.db
      .select({ userId: schema.eventSignups.userId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    const usersToNotify = signups
      .map((s) => s.userId)
      .filter((id): id is number => id !== null);

    const eventTitle = existing[0].title;
    const reasonSuffix = dto.reason ? ` Reason: ${dto.reason}` : '';

    const discordUrl =
      await this.notificationService.getDiscordEmbedUrl(eventId);

    await Promise.all(
      usersToNotify.map((uid) =>
        this.notificationService.create({
          userId: uid,
          type: 'event_cancelled',
          title: 'Event Cancelled',
          message: `"${eventTitle}" has been cancelled.${reasonSuffix}`,
          payload: {
            eventId,
            reason: dto.reason ?? null,
            startTime: existing[0].duration[0].toISOString(),
            ...(discordUrl ? { discordUrl } : {}),
          },
        }),
      ),
    );

    const cancelledEvent = await this.findOne(eventId);
    this.emitEventLifecycle(APP_EVENT_EVENTS.CANCELLED, cancelledEvent);
    return cancelledEvent;
  }

  async getRosterAvailability(
    eventId: number,
    from?: string,
    to?: string,
  ): Promise<RosterAvailabilityResponse> {
    const [event, signups] = await Promise.all([
      this.findOne(eventId),
      this.db
        .select({ signup: schema.eventSignups, user: schema.users })
        .from(schema.eventSignups)
        .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
        .where(eq(schema.eventSignups.eventId, eventId)),
    ]);

    const eventStart = new Date(event.startTime);
    const eventEnd = new Date(event.endTime);
    const bufferMs = 2 * 60 * 60 * 1000;
    const startTime =
      from || new Date(eventStart.getTime() - bufferMs).toISOString();
    const endTime = to || new Date(eventEnd.getTime() + bufferMs).toISOString();

    if (signups.length === 0) {
      return { eventId, timeRange: { start: startTime, end: endTime }, users: [] };
    }

    const userIds = signups
      .filter((s) => s.user !== null)
      .map((s) => s.user!.id);

    const availabilityMap = await this.availabilityService.findForUsersInRange(
      userIds,
      startTime,
      endTime,
    );

    const users: UserWithAvailabilitySlots[] = signups
      .filter((s) => s.user !== null)
      .map((s) => {
        const userAvailability = availabilityMap.get(s.user!.id) || [];
        return {
          id: s.user!.id,
          username: s.user!.username,
          avatar: s.user!.avatar,
          discordId: s.user!.discordId,
          customAvatarUrl: s.user!.customAvatarUrl,
          slots: userAvailability.map((a) => ({
            start: a.timeRange.start,
            end: a.timeRange.end,
            status: a.status,
            gameId: a.gameId,
            sourceEventId: a.sourceEventId,
          })),
        };
      });

    return { eventId, timeRange: { start: startTime, end: endTime }, users };
  }

  async getAggregateGameTime(
    eventId: number,
  ): Promise<AggregateGameTimeResponse> {
    const [, signups] = await Promise.all([
      this.exists(eventId),
      this.db
        .select({ userId: schema.eventSignups.userId })
        .from(schema.eventSignups)
        .where(
          and(
            eq(schema.eventSignups.eventId, eventId),
            ne(schema.eventSignups.status, 'roached_out'),
            ne(schema.eventSignups.status, 'departed'),
            ne(schema.eventSignups.status, 'declined'),
          ),
        ),
    ]);

    const userIds = signups
      .map((s) => s.userId)
      .filter((id): id is number => id !== null);

    if (userIds.length === 0) {
      return { eventId, totalUsers: 0, cells: [] };
    }

    const templates = await this.db
      .select({
        dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
        startHour: schema.gameTimeTemplates.startHour,
      })
      .from(schema.gameTimeTemplates)
      .where(inArray(schema.gameTimeTemplates.userId, userIds));

    const countMap = new Map<string, number>();
    for (const t of templates) {
      const displayDay = (t.dayOfWeek + 1) % 7;
      const key = `${displayDay}:${t.startHour}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    const cells = Array.from(countMap.entries()).map(([key, count]) => {
      const [day, hour] = key.split(':').map(Number);
      return {
        dayOfWeek: day,
        hour,
        availableCount: count,
        totalCount: userIds.length,
      };
    });

    return { eventId, totalUsers: userIds.length, cells };
  }

  async reschedule(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: RescheduleEventDto,
  ): Promise<EventResponseDto> {
    const existing = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    if (existing[0].creatorId !== userId && !isAdmin) {
      throw new ForbiddenException('You can only reschedule your own events');
    }

    const newStart = new Date(dto.startTime);
    const newEnd = new Date(dto.endTime);

    await this.db
      .update(schema.events)
      .set({ duration: [newStart, newEnd], updatedAt: new Date() })
      .where(eq(schema.events.id, eventId));

    await this.db
      .delete(schema.eventRemindersSent)
      .where(eq(schema.eventRemindersSent.eventId, eventId));

    await this.db
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'pending' })
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          ne(schema.eventSignups.status, 'declined'),
          ne(schema.eventSignups.status, 'departed'),
        ),
      );

    this.logger.log(`Event rescheduled: ${eventId} by user ${userId}`);

    const signups = await this.db
      .select({ userId: schema.eventSignups.userId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    const usersToNotify = signups
      .map((s) => s.userId)
      .filter((id): id is number => id !== null && id !== userId);

    const eventTitle = existing[0].title;
    const formatTime = (d: Date) =>
      d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

    const discordUrl =
      await this.notificationService.getDiscordEmbedUrl(eventId);

    const voiceChannelId = await this.notificationService.resolveVoiceChannelId(
      existing[0].gameId,
    );

    await Promise.all(
      usersToNotify.map((uid) =>
        this.notificationService.create({
          userId: uid,
          type: 'event_rescheduled',
          title: 'Event Rescheduled',
          message: `"${eventTitle}" has been moved to ${formatTime(newStart)}`,
          payload: {
            eventId,
            oldStartTime: existing[0].duration[0].toISOString(),
            oldEndTime: existing[0].duration[1].toISOString(),
            newStartTime: dto.startTime,
            newEndTime: dto.endTime,
            startTime: dto.startTime,
            ...(discordUrl ? { discordUrl } : {}),
            ...(voiceChannelId ? { voiceChannelId } : {}),
          },
        }),
      ),
    );

    const rescheduledEvent = await this.findOne(eventId);
    this.emitEventLifecycle(APP_EVENT_EVENTS.UPDATED, rescheduledEvent);
    return rescheduledEvent;
  }

  async inviteMember(
    eventId: number,
    inviterId: number,
    isAdmin: boolean,
    discordId: string,
  ): Promise<{ message: string }> {
    const event = await this.findOne(eventId);

    const [targetUser] = await this.db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordId))
      .limit(1);

    if (!targetUser) {
      throw new NotFoundException(
        'No registered user found with that Discord ID',
      );
    }

    const [existingSignup] = await this.db
      .select({ id: schema.eventSignups.id })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, targetUser.id),
        ),
      );

    if (existingSignup) {
      throw new BadRequestException(
        `${targetUser.username} is already signed up for this event`,
      );
    }

    const [inviter] = await this.db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, inviterId))
      .limit(1);

    const notification = await this.notificationService.create({
      userId: targetUser.id,
      type: 'new_event',
      title: 'Event Invitation',
      message: `${inviter?.username ?? 'Someone'} invited you to "${event.title}"`,
      payload: { eventId, invitedBy: inviter?.username ?? null },
      skipDiscord: true,
    });

    if (notification) {
      this.eventEmitter.emit(MEMBER_INVITE_EVENTS.CREATED, {
        eventId,
        targetDiscordId: discordId,
        notificationId: notification.id,
        gameId: event.game?.id ?? null,
      } satisfies MemberInviteCreatedPayload);
    }

    this.logger.log(
      `User ${inviterId} invited registered member ${targetUser.id} (${targetUser.username}) to event ${eventId}`,
    );

    return { message: `Invite sent to ${targetUser.username}` };
  }

  async buildEmbedEventData(eventId: number): Promise<EmbedEventData> {
    const event = await this.findOne(eventId);
    return buildEmbedEventData(this.db, event, eventId);
  }

  async getVariantContext(
    eventId: number,
  ): Promise<{ gameVariant: string | null; region: string | null }> {
    return getVariantContext(this.db, eventId);
  }

  private mapToResponse(
    row: {
      events: typeof schema.events.$inferSelect;
      users: typeof schema.users.$inferSelect | null;
      games: typeof schema.games.$inferSelect | null;
      signupCount: number;
    },
    signupsPreview?: {
      id: number;
      discordId: string;
      username: string;
      avatar: string | null;
      customAvatarUrl?: string | null;
      characters?: { gameId: number; avatarUrl: string | null }[];
    }[],
  ): EventResponseDto {
    return mapEventToResponse(row, signupsPreview);
  }

  private emitEventLifecycle(
    eventName: string,
    eventResponse: EventResponseDto,
  ): void {
    this.eventEmitter.emit(eventName, buildLifecyclePayload(eventResponse));
  }
}
