import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, gte, lte, asc, sql, and, inArray } from 'drizzle-orm';
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
  DashboardEventDto,
  RosterAvailabilityResponse,
  UserWithAvailabilitySlots,
  AggregateGameTimeResponse,
  RescheduleEventDto,
} from '@raid-ledger/contract';
import { randomUUID } from 'crypto';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';

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
  ) {}

  /**
   * Create a new event.
   * @param creatorId - ID of the user creating the event
   * @param dto - Event creation data
   * @returns Created event with full details
   */
  async create(
    creatorId: number,
    dto: CreateEventDto,
  ): Promise<EventResponseDto & { allEventIds?: number[] }> {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    const durationMs = endTime.getTime() - startTime.getTime();

    // Generate recurrence group if recurring
    const recurrenceGroupId = dto.recurrence ? randomUUID() : null;

    // Build base values shared across all instances
    const baseValues = {
      title: dto.title,
      description: dto.description ?? null,
      gameId: dto.gameId ? String(dto.gameId) : null,
      registryGameId: dto.registryGameId ?? null,
      creatorId,
      slotConfig: dto.slotConfig ?? null,
      maxAttendees: dto.maxAttendees ?? null,
      autoUnbench: dto.autoUnbench ?? true,
      recurrenceGroupId,
      recurrenceRule: dto.recurrence ?? null,
      contentInstances: dto.contentInstances ?? null,
    };

    if (dto.recurrence) {
      // Generate all recurring instances
      const instances = this.generateRecurringDates(
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

      // Return the first instance with all IDs for controller to auto-signup
      const response = await this.findOne(events[0].id);
      return { ...response, allEventIds: events.map((e) => e.id) };
    }

    // Single event
    const [event] = await this.db
      .insert(schema.events)
      .values({
        ...baseValues,
        duration: [startTime, endTime],
      })
      .returning();

    this.logger.log(`Event created: ${event.id} by user ${creatorId}`);

    return this.findOne(event.id);
  }

  /**
   * Generate recurring date instances from a start date.
   */
  private generateRecurringDates(
    start: Date,
    frequency: 'weekly' | 'biweekly' | 'monthly',
    until: Date,
  ): Date[] {
    const dates: Date[] = [new Date(start)];
    let current = new Date(start);

    while (true) {
      const next = new Date(current);
      if (frequency === 'weekly') {
        next.setDate(next.getDate() + 7);
      } else if (frequency === 'biweekly') {
        next.setDate(next.getDate() + 14);
      } else {
        // monthly: same day of month, next month
        next.setMonth(next.getMonth() + 1);
      }

      if (next > until) break;
      dates.push(next);
      current = next;
    }

    return dates;
  }

  /**
   * Get paginated list of events.
   * Supports filtering by date range (ROK-174), game ID, creatorId, signedUpAs (ROK-213).
   * @param query - Pagination and filter options
   * @param authenticatedUserId - ID of the requesting user (if authenticated)
   * @returns Paginated event list
   */
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

    // Build where conditions array (ROK-174: Date Range Filtering)
    const conditions: ReturnType<typeof gte>[] = [];

    // Existing: upcoming filter (events that haven't ended yet)
    if (query.upcoming === 'true') {
      conditions.push(
        gte(
          sql`upper(${schema.events.duration})`,
          sql`${new Date().toISOString()}::timestamp`,
        ),
      );
    }

    // ROK-174: startAfter filter - events starting after this date
    if (query.startAfter) {
      conditions.push(
        gte(
          sql`lower(${schema.events.duration})`,
          sql`${query.startAfter}::timestamp`,
        ),
      );
    }

    // ROK-174: endBefore filter - events ending before this date
    if (query.endBefore) {
      conditions.push(
        lte(
          sql`upper(${schema.events.duration})`,
          sql`${query.endBefore}::timestamp`,
        ),
      );
    }

    // gameId filter
    if (query.gameId) {
      conditions.push(eq(schema.events.gameId, query.gameId));
    }

    // ROK-213: creatorId filter — "me" resolves to authenticated user
    if (query.creatorId) {
      const resolvedCreatorId =
        query.creatorId === 'me'
          ? authenticatedUserId
          : Number(query.creatorId);
      if (resolvedCreatorId) {
        conditions.push(eq(schema.events.creatorId, resolvedCreatorId));
      }
    }

    // ROK-213: signedUpAs filter — "me" resolves to authenticated user
    if (query.signedUpAs && query.signedUpAs === 'me' && authenticatedUserId) {
      const signedUpEventIds = this.db
        .select({ eventId: schema.eventSignups.eventId })
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.userId, authenticatedUserId));
      conditions.push(inArray(schema.events.id, signedUpEventIds));
    }

    // Combine all conditions with AND
    const whereCondition =
      conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count (respecting filters)
    const countQuery = this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events);

    const countResult = whereCondition
      ? await countQuery.where(whereCondition)
      : await countQuery;

    const total = Number(countResult[0].count);

    // Subquery to count signups per event
    const signupCountSubquery = this.db
      .select({
        eventId: schema.eventSignups.eventId,
        count: sql<number>`count(*)`.as('signup_count'),
      })
      .from(schema.eventSignups)
      .groupBy(schema.eventSignups.eventId)
      .as('signup_counts');

    // Build events query with creator, game, and signup count
    let eventsQuery = this.db
      .select({
        events: schema.events,
        users: schema.users,
        games: schema.games,
        gameRegistry: schema.gameRegistry,
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(
        schema.games,
        eq(schema.events.gameId, sql`${schema.games.igdbId}::text`),
      )
      .leftJoin(
        schema.gameRegistry,
        eq(schema.events.registryGameId, schema.gameRegistry.id),
      )
      .leftJoin(
        signupCountSubquery,
        eq(schema.events.id, signupCountSubquery.eventId),
      )
      .$dynamic();

    // Apply filters to events query
    if (whereCondition) {
      eventsQuery = eventsQuery.where(whereCondition);
    }

    // ROK-174 AC-3: Order by start_time ASC for calendar views
    const events = await eventsQuery
      .orderBy(asc(sql`lower(${schema.events.duration})`))
      .limit(limit)
      .offset(offset);

    // ROK-177, ROK-194: Fetch signups preview if requested (prevents N+1)
    let signupsPreviewMap: Map<
      number,
      {
        id: number;
        discordId: string;
        username: string;
        avatar: string | null;
        customAvatarUrl?: string | null;
        characters?: { gameId: string; avatarUrl: string | null }[];
      }[]
    > = new Map();
    if (query.includeSignups === 'true' && events.length > 0) {
      const eventIds = events.map((e) => e.events.id);
      signupsPreviewMap = await this.getSignupsPreviewForEvents(eventIds, 5);
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
      },
    };
  }

  /**
   * Get a single event by ID.
   * @param id - Event ID
   * @returns Event with full details
   * @throws NotFoundException if event not found
   */
  async findOne(id: number): Promise<EventResponseDto> {
    // Subquery to count signups for this event
    const signupCountSubquery = this.db
      .select({
        eventId: schema.eventSignups.eventId,
        count: sql<number>`count(*)`.as('signup_count'),
      })
      .from(schema.eventSignups)
      .groupBy(schema.eventSignups.eventId)
      .as('signup_counts');

    const results = await this.db
      .select({
        events: schema.events,
        users: schema.users,
        games: schema.games,
        gameRegistry: schema.gameRegistry,
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(
        schema.games,
        eq(schema.events.gameId, sql`${schema.games.igdbId}::text`),
      )
      .leftJoin(
        schema.gameRegistry,
        eq(schema.events.registryGameId, schema.gameRegistry.id),
      )
      .leftJoin(
        signupCountSubquery,
        eq(schema.events.id, signupCountSubquery.eventId),
      )
      .where(eq(schema.events.id, id))
      .limit(1);

    if (results.length === 0) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    return this.mapToResponse(results[0]);
  }

  /**
   * Get organizer dashboard with aggregate stats and enriched event cards (ROK-213).
   * Admins see all upcoming events; regular users see only events they created.
   * @param userId - ID of the requesting user
   * @param isAdmin - Whether the user is an admin
   * @returns Dashboard with stats and enriched events
   */
  async getMyDashboard(
    userId: number,
    isAdmin: boolean,
  ): Promise<DashboardResponseDto> {
    // 1. Build condition: upcoming events only, scoped by user/admin
    const now = new Date().toISOString();
    const conditions: ReturnType<typeof gte>[] = [
      gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
    ];
    if (!isAdmin) {
      conditions.push(eq(schema.events.creatorId, userId));
    }
    const whereCondition = and(...conditions);

    // 2. Get events with signup counts (reuse findAll pattern)
    const signupCountSubquery = this.db
      .select({
        eventId: schema.eventSignups.eventId,
        count: sql<number>`count(*)`.as('signup_count'),
      })
      .from(schema.eventSignups)
      .groupBy(schema.eventSignups.eventId)
      .as('signup_counts');

    const events = await this.db
      .select({
        events: schema.events,
        users: schema.users,
        games: schema.games,
        gameRegistry: schema.gameRegistry,
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(
        schema.games,
        eq(schema.events.gameId, sql`${schema.games.igdbId}::text`),
      )
      .leftJoin(
        schema.gameRegistry,
        eq(schema.events.registryGameId, schema.gameRegistry.id),
      )
      .leftJoin(
        signupCountSubquery,
        eq(schema.events.id, signupCountSubquery.eventId),
      )
      .where(whereCondition)
      .orderBy(asc(sql`lower(${schema.events.duration})`));

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

    const eventIds = events.map((e) => e.events.id);

    // 3. Batch query: unconfirmed signups per event
    const unconfirmedRows = await this.db
      .select({
        eventId: schema.eventSignups.eventId,
        count: sql<number>`count(*)`.as('unconfirmed_count'),
      })
      .from(schema.eventSignups)
      .where(
        and(
          inArray(schema.eventSignups.eventId, eventIds),
          eq(schema.eventSignups.confirmationStatus, 'pending'),
        ),
      )
      .groupBy(schema.eventSignups.eventId);

    const unconfirmedMap = new Map(
      unconfirmedRows.map((r) => [r.eventId, Number(r.count)]),
    );

    // 4. Batch query: roster assignments per event+role
    const assignmentRows = await this.db
      .select({
        eventId: schema.rosterAssignments.eventId,
        role: schema.rosterAssignments.role,
        count: sql<number>`count(*)`.as('assigned_count'),
      })
      .from(schema.rosterAssignments)
      .where(inArray(schema.rosterAssignments.eventId, eventIds))
      .groupBy(schema.rosterAssignments.eventId, schema.rosterAssignments.role);

    // Group assignments: eventId -> { role -> count }
    const assignmentMap = new Map<number, Map<string, number>>();
    for (const row of assignmentRows) {
      if (!assignmentMap.has(row.eventId)) {
        assignmentMap.set(row.eventId, new Map());
      }
      assignmentMap
        .get(row.eventId)!
        .set(row.role ?? 'player', Number(row.count));
    }

    // 5. Compute per-event metrics and build response
    let totalSignups = 0;
    let totalFillRateSum = 0;
    let eventsWithSlots = 0;
    let eventsWithGaps = 0;

    const dashboardEvents: DashboardEventDto[] = events.map((row) => {
      const base = this.mapToResponse(row);
      const signupCount = Number(row.signupCount);
      totalSignups += signupCount;

      const slotConfig = row.events.slotConfig as {
        type?: string;
        tank?: number;
        healer?: number;
        dps?: number;
        flex?: number;
        player?: number;
        bench?: number;
      } | null;

      let rosterFillPercent = 0;
      const missingRoles: string[] = [];

      if (slotConfig) {
        const assignments =
          assignmentMap.get(row.events.id) ?? new Map<string, number>();
        const roles =
          slotConfig.type === 'mmo'
            ? (['tank', 'healer', 'dps', 'flex'] as const)
            : (['player'] as const);

        let totalSlots = 0;
        let filledSlots = 0;

        for (const role of roles) {
          const needed = slotConfig[role] ?? 0;
          if (needed === 0) continue;
          totalSlots += needed;
          const assigned = assignments.get(role) ?? 0;
          filledSlots += Math.min(assigned, needed);
          if (assigned < needed) {
            missingRoles.push(`${needed - assigned} ${role}`);
          }
        }

        rosterFillPercent =
          totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
        eventsWithSlots++;
        totalFillRateSum += rosterFillPercent;

        if (missingRoles.length > 0) {
          eventsWithGaps++;
        }
      } else if (row.events.maxAttendees) {
        // No slot config but has max attendees — use signup count as fill
        rosterFillPercent = Math.round(
          (signupCount / row.events.maxAttendees) * 100,
        );
        eventsWithSlots++;
        totalFillRateSum += rosterFillPercent;
        if (signupCount < row.events.maxAttendees) {
          eventsWithGaps++;
        }
      }

      return {
        ...base,
        rosterFillPercent,
        unconfirmedCount: unconfirmedMap.get(row.events.id) ?? 0,
        missingRoles,
      };
    });

    return {
      stats: {
        totalUpcomingEvents: events.length,
        totalSignups,
        averageFillRate:
          eventsWithSlots > 0
            ? Math.round(totalFillRateSum / eventsWithSlots)
            : 0,
        eventsWithRosterGaps: eventsWithGaps,
      },
      events: dashboardEvents,
    };
  }

  /**
   * Update an event.
   * @param id - Event ID
   * @param userId - ID of user making the update
   * @param isAdmin - Whether the user is an admin
   * @param dto - Update data
   * @returns Updated event
   * @throws NotFoundException if event not found
   * @throws ForbiddenException if user is not creator or admin
   */
  async update(
    id: number,
    userId: number,
    isAdmin: boolean,
    dto: UpdateEventDto,
  ): Promise<EventResponseDto> {
    // Check event exists and user has permission
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

    // Build update object
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.gameId !== undefined)
      updateData.gameId = dto.gameId ? String(dto.gameId) : null;
    if (dto.registryGameId !== undefined)
      updateData.registryGameId = dto.registryGameId ?? null;
    if (dto.slotConfig !== undefined) updateData.slotConfig = dto.slotConfig;
    if (dto.maxAttendees !== undefined)
      updateData.maxAttendees = dto.maxAttendees;
    if (dto.autoUnbench !== undefined) updateData.autoUnbench = dto.autoUnbench;
    if (dto.contentInstances !== undefined)
      updateData.contentInstances = dto.contentInstances;

    // Handle time updates with validation
    if (dto.startTime || dto.endTime) {
      const currentDuration = existing[0].duration;
      const startTime = dto.startTime
        ? new Date(dto.startTime)
        : currentDuration[0];
      const endTime = dto.endTime ? new Date(dto.endTime) : currentDuration[1];

      // Server-side validation: ensure start < end after merge
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

    return this.findOne(id);
  }

  /**
   * Delete an event.
   * @param id - Event ID
   * @param userId - ID of user making the deletion
   * @param isAdmin - Whether the user is an admin
   * @throws NotFoundException if event not found
   * @throws ForbiddenException if user is not creator or admin
   */
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

    await this.db.delete(schema.events).where(eq(schema.events.id, id));

    this.logger.log(`Event deleted: ${id} by user ${userId}`);
  }

  /**
   * Get availability for all signed-up users (ROK-113).
   * Used by heatmap component to visualize team availability.
   * @param eventId - Event ID
   * @param from - Optional: override start time (defaults to event start - 2h)
   * @param to - Optional: override end time (defaults to event end + 2h)
   * @returns Roster availability data for heatmap
   * @throws NotFoundException if event not found
   */
  async getRosterAvailability(
    eventId: number,
    from?: string,
    to?: string,
  ): Promise<RosterAvailabilityResponse> {
    // Get event details
    const event = await this.findOne(eventId);

    // Calculate time window (event duration ± 2 hours buffer)
    const eventStart = new Date(event.startTime);
    const eventEnd = new Date(event.endTime);
    const bufferMs = 2 * 60 * 60 * 1000; // 2 hours
    const startTime =
      from || new Date(eventStart.getTime() - bufferMs).toISOString();
    const endTime = to || new Date(eventEnd.getTime() + bufferMs).toISOString();

    // Get all signups for this event
    const signups = await this.db
      .select({
        signup: schema.eventSignups,
        user: schema.users,
      })
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .where(eq(schema.eventSignups.eventId, eventId));

    if (signups.length === 0) {
      return {
        eventId,
        timeRange: { start: startTime, end: endTime },
        users: [],
      };
    }

    // Get user IDs from signups
    const userIds = signups
      .filter((s) => s.user !== null)
      .map((s) => s.user!.id);

    // Fetch availability for all signed-up users
    const availabilityMap = await this.availabilityService.findForUsersInRange(
      userIds,
      startTime,
      endTime,
    );

    // Build response with user info and their slots
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

    return {
      eventId,
      timeRange: { start: startTime, end: endTime },
      users,
    };
  }

  /**
   * Get aggregate game time for all signed-up users (ROK-223).
   * Returns a heatmap of how many players are available at each day/hour.
   * @param eventId - Event ID
   * @returns Aggregate game time data for heatmap display
   */
  async getAggregateGameTime(
    eventId: number,
  ): Promise<AggregateGameTimeResponse> {
    // Verify event exists
    await this.findOne(eventId);

    // Get all signed-up user IDs
    const signups = await this.db
      .select({ userId: schema.eventSignups.userId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    const userIds = signups.map((s) => s.userId);

    if (userIds.length === 0) {
      return { eventId, totalUsers: 0, cells: [] };
    }

    // Batch-fetch all game time templates for signed-up users
    const templates = await this.db
      .select({
        dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
        startHour: schema.gameTimeTemplates.startHour,
      })
      .from(schema.gameTimeTemplates)
      .where(inArray(schema.gameTimeTemplates.userId, userIds));

    // Aggregate: count available users per day/hour cell
    // DB uses 0=Mon convention, convert to display 0=Sun convention: (dbDay + 1) % 7
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

  /**
   * Reschedule an event to a new time (ROK-223).
   * Notifies all signed-up users (except the rescheduler).
   * @param eventId - Event ID
   * @param userId - ID of user performing the reschedule
   * @param isAdmin - Whether the user is an admin
   * @param dto - New start/end times
   * @returns Updated event
   */
  async reschedule(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: RescheduleEventDto,
  ): Promise<EventResponseDto> {
    // Check event exists and user has permission
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

    // Update the event duration
    await this.db
      .update(schema.events)
      .set({
        duration: [newStart, newEnd],
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, eventId));

    this.logger.log(`Event rescheduled: ${eventId} by user ${userId}`);

    // Notify all signed-up users (except the rescheduler)
    const signups = await this.db
      .select({ userId: schema.eventSignups.userId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    const usersToNotify = signups
      .map((s) => s.userId)
      .filter((id) => id !== userId);

    const eventTitle = existing[0].title;
    const formatTime = (d: Date) =>
      d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

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
          },
        }),
      ),
    );

    return this.findOne(eventId);
  }

  /**
   * Get first N signups for multiple events (ROK-177, ROK-194).
   * Batched query to avoid N+1 for calendar views.
   * Includes character data for avatar resolution (ROK-194).
   * @param eventIds - Event IDs to fetch signups for
   * @param limit - Max signups per event (default 5)
   * @returns Map of eventId -> signups preview array with character data
   */
  private async getSignupsPreviewForEvents(
    eventIds: number[],
    limit = 5,
  ): Promise<
    Map<
      number,
      {
        id: number;
        discordId: string;
        username: string;
        avatar: string | null;
        customAvatarUrl?: string | null;
        characters?: { gameId: string; avatarUrl: string | null }[];
      }[]
    >
  > {
    if (eventIds.length === 0) return new Map();

    // Fetch all signups for these events with user info, ordered by signup time
    const signups = await this.db
      .select({
        eventId: schema.eventSignups.eventId,
        userId: schema.users.id,
        discordId: schema.users.discordId,
        username: schema.users.username,
        avatar: schema.users.avatar,
        customAvatarUrl: schema.users.customAvatarUrl,
        signedUpAt: schema.eventSignups.signedUpAt,
      })
      .from(schema.eventSignups)
      .innerJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .where(inArray(schema.eventSignups.eventId, eventIds))
      .orderBy(asc(schema.eventSignups.signedUpAt));

    // Get unique user IDs for character lookup (ROK-194)
    const userIds = [...new Set(signups.map((s) => s.userId))];

    // Fetch characters for all users (ROK-194)
    const charactersData =
      userIds.length > 0
        ? await this.db
            .select({
              userId: schema.characters.userId,
              gameId: schema.characters.gameId,
              avatarUrl: schema.characters.avatarUrl,
            })
            .from(schema.characters)
            .where(inArray(schema.characters.userId, userIds))
        : [];

    // Build character map: userId -> characters[]
    const charactersByUser = new Map<
      number,
      { gameId: string; avatarUrl: string | null }[]
    >();
    for (const char of charactersData) {
      if (!charactersByUser.has(char.userId)) {
        charactersByUser.set(char.userId, []);
      }
      charactersByUser.get(char.userId)!.push({
        gameId: char.gameId,
        avatarUrl: char.avatarUrl,
      });
    }

    // Group by event and take first N
    const result = new Map<
      number,
      {
        id: number;
        discordId: string;
        username: string;
        avatar: string | null;
        customAvatarUrl?: string | null;
        characters?: { gameId: string; avatarUrl: string | null }[];
      }[]
    >();
    for (const signup of signups) {
      if (!result.has(signup.eventId)) {
        result.set(signup.eventId, []);
      }
      const eventSignups = result.get(signup.eventId)!;
      if (eventSignups.length < limit) {
        const userCharacters = charactersByUser.get(signup.userId);
        eventSignups.push({
          id: signup.userId,
          discordId: signup.discordId ?? '',
          username: signup.username,
          avatar: signup.avatar,
          customAvatarUrl: signup.customAvatarUrl,
          characters: userCharacters,
        });
      }
    }

    return result;
  }

  /**
   * Map database row to response DTO.
   * @param row - Database row with joined tables
   * @param signupsPreview - Optional signups preview for calendar views (ROK-177, ROK-194)
   */
  private mapToResponse(
    row: {
      events: typeof schema.events.$inferSelect;
      users: typeof schema.users.$inferSelect | null;
      games: typeof schema.games.$inferSelect | null;
      gameRegistry: typeof schema.gameRegistry.$inferSelect | null;
      signupCount: number;
    },
    signupsPreview?: {
      id: number;
      discordId: string;
      username: string;
      avatar: string | null;
      customAvatarUrl?: string | null;
      characters?: { gameId: string; avatarUrl: string | null }[];
    }[],
  ): EventResponseDto {
    const {
      events: event,
      users: creator,
      games: game,
      gameRegistry: registry,
      signupCount,
    } = row;

    // Prefer gameRegistry for slug (color coding) but use IGDB game coverUrl for artwork
    // Priority: registry slug/name + game coverUrl > game only > registry only
    // ROK-194: Include registryId (UUID) for character avatar resolution
    let gameData = null;
    if (registry) {
      gameData = {
        id: game?.id ?? 0, // Use IGDB games PK when available for cross-reference links
        registryId: registry.id, // ROK-194: UUID for character matching
        name: registry.name,
        slug: registry.slug,
        // Prefer IGDB coverUrl if available, fallback to registry iconUrl
        coverUrl: game?.coverUrl || registry.iconUrl,
      };
    } else if (game) {
      gameData = {
        id: game.id,
        registryId: null, // No registry ID for IGDB-only games
        name: game.name,
        slug: game.slug,
        coverUrl: game.coverUrl,
      };
    }

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      startTime: event.duration[0].toISOString(),
      endTime: event.duration[1].toISOString(),
      creator: {
        id: creator?.id ?? 0,
        username: creator?.username ?? 'Unknown',
        avatar: creator?.avatar ?? null,
        customAvatarUrl: creator?.customAvatarUrl ?? null,
      },
      game: gameData,
      signupCount: Number(signupCount),
      signupsPreview,
      slotConfig: (event.slotConfig as EventResponseDto['slotConfig']) ?? null,
      maxAttendees: event.maxAttendees ?? null,
      autoUnbench: event.autoUnbench ?? true,
      contentInstances:
        (event.contentInstances as EventResponseDto['contentInstances']) ??
        null,
      recurrenceGroupId: event.recurrenceGroupId ?? null,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}
