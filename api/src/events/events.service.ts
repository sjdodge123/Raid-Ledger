import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, desc, gte, lte, asc, sql, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CreateEventDto,
  UpdateEventDto,
  EventResponseDto,
  EventListResponseDto,
  EventListQueryDto,
  RosterAvailabilityResponse,
  UserWithAvailabilitySlots,
} from '@raid-ledger/contract';
import { AvailabilityService } from '../availability/availability.service';

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
  ) { }

  /**
   * Create a new event.
   * @param creatorId - ID of the user creating the event
   * @param dto - Event creation data
   * @returns Created event with full details
   */
  async create(
    creatorId: number,
    dto: CreateEventDto,
  ): Promise<EventResponseDto> {
    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    const [event] = await this.db
      .insert(schema.events)
      .values({
        title: dto.title,
        description: dto.description ?? null,
        gameId: dto.gameId ? String(dto.gameId) : null,
        creatorId,
        duration: [startTime, endTime],
      })
      .returning();

    this.logger.log(`Event created: ${event.id} by user ${creatorId}`);

    return this.findOne(event.id);
  }

  /**
   * Get paginated list of events.
   * Supports filtering by date range (ROK-174) and game ID.
   * @param query - Pagination and filter options
   * @returns Paginated event list
   */
  async findAll(query: EventListQueryDto): Promise<EventListResponseDto> {
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

    const data = events.map((row) => this.mapToResponse(row));

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
   * Map database row to response DTO.
   */
  private mapToResponse(row: {
    events: typeof schema.events.$inferSelect;
    users: typeof schema.users.$inferSelect | null;
    games: typeof schema.games.$inferSelect | null;
    gameRegistry: typeof schema.gameRegistry.$inferSelect | null;
    signupCount: number;
  }): EventResponseDto {
    const { events: event, users: creator, games: game, gameRegistry: registry, signupCount } = row;

    // Prefer gameRegistry for slug (color coding) but use IGDB game coverUrl for artwork
    // Priority: registry slug/name + game coverUrl > game only > registry only
    let gameData = null;
    if (registry) {
      gameData = {
        id: 0, // No numeric ID for registry
        name: registry.name,
        slug: registry.slug,
        // Prefer IGDB coverUrl if available, fallback to registry iconUrl
        coverUrl: game?.coverUrl || registry.iconUrl,
      };
    } else if (game) {
      gameData = {
        id: game.id,
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
      },
      game: gameData,
      signupCount: Number(signupCount),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}
