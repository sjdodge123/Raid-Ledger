import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, desc, gte, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CreateEventDto,
  UpdateEventDto,
  EventResponseDto,
  EventListResponseDto,
  EventListQueryDto,
} from '@raid-ledger/contract';

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

    // Build where condition for upcoming filter
    // Note: postgres driver requires string, not Date object
    const upcomingCondition =
      query.upcoming === 'true'
        ? gte(
            sql`upper(${schema.events.duration})`,
            sql`${new Date().toISOString()}::timestamp`,
          )
        : undefined;

    // Get total count (respecting filters)
    const countQuery = this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events);

    // Apply filter to count if needed
    const countResult = upcomingCondition
      ? await countQuery.where(upcomingCondition)
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
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(
        schema.games,
        eq(schema.events.gameId, sql`${schema.games.id}::text`),
      )
      .leftJoin(
        signupCountSubquery,
        eq(schema.events.id, signupCountSubquery.eventId),
      )
      .$dynamic();

    // Apply filter to events if needed
    if (upcomingCondition) {
      eventsQuery = eventsQuery.where(upcomingCondition);
    }

    const events = await eventsQuery
      .orderBy(desc(sql`lower(${schema.events.duration})`))
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
        signupCount: sql<number>`coalesce(${signupCountSubquery.count}, 0)`,
      })
      .from(schema.events)
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(
        schema.games,
        eq(schema.events.gameId, sql`${schema.games.id}::text`),
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
   * Map database row to response DTO.
   */
  private mapToResponse(row: {
    events: typeof schema.events.$inferSelect;
    users: typeof schema.users.$inferSelect | null;
    games: typeof schema.games.$inferSelect | null;
    signupCount: number;
  }): EventResponseDto {
    const { events: event, users: creator, games: game, signupCount } = row;

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
      game: game
        ? {
            id: game.id,
            name: game.name,
            slug: game.slug,
            coverUrl: game.coverUrl,
          }
        : null,
      signupCount: Number(signupCount),
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}
