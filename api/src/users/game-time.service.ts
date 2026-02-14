import { Inject, Injectable } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm';

export interface TemplateSlot {
  dayOfWeek: number;
  hour: number;
}

export interface CompositeSlot {
  dayOfWeek: number;
  hour: number;
  status: 'available' | 'committed' | 'blocked' | 'freed';
  fromTemplate?: boolean;
}

export interface EventBlockDescriptor {
  eventId: number;
  title: string;
  gameSlug: string | null;
  gameName: string | null;
  gameRegistryId: string | null;
  coverUrl: string | null;
  signupId: number;
  confirmationStatus: 'pending' | 'confirmed' | 'changed';
  dayOfWeek: number;
  startHour: number;
  endHour: number; // exclusive, 24 = end of day
  description: string | null;
  creatorUsername: string | null;
  signupsPreview: Array<{
    id: number;
    username: string;
    avatar: string | null;
    characters?: Array<{ gameId: string; avatarUrl: string | null }>;
  }>;
  signupCount: number;
}

export interface OverrideRecord {
  date: string;
  hour: number;
  status: string;
}

export interface AbsenceRecord {
  id: number;
  startDate: string;
  endDate: string;
  reason: string | null;
}

/**
 * Service for managing recurring weekly game time templates (ROK-189).
 */
@Injectable()
export class GameTimeService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Get a user's game time template (raw slots, no status).
   */
  async getTemplate(userId: number): Promise<{ slots: TemplateSlot[] }> {
    const rows = await this.db
      .select({
        dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
        startHour: schema.gameTimeTemplates.startHour,
      })
      .from(schema.gameTimeTemplates)
      .where(eq(schema.gameTimeTemplates.userId, userId));

    return {
      slots: rows.map((r) => ({ dayOfWeek: r.dayOfWeek, hour: r.startHour })),
    };
  }

  /**
   * Replace a user's game time template entirely (delete + bulk insert in transaction).
   * Frontend sends 0=Sun convention; we convert to DB 0=Mon convention.
   *
   * Committed-slot preservation: template slots that overlap with active event
   * signups are automatically preserved server-side, even if the frontend does
   * not include them in the payload. This prevents a race condition where stale
   * TanStack Query cache on the frontend could cause committed slots to be
   * dropped during a save.
   */
  async saveTemplate(
    userId: number,
    slots: TemplateSlot[],
  ): Promise<{ slots: TemplateSlot[] }> {
    // Convert from display convention (0=Sun) to DB convention (0=Mon)
    const dbSlots = slots.map((s) => ({
      ...s,
      dayOfWeek: (s.dayOfWeek + 6) % 7,
    }));

    // Find template slots that overlap with active event signups.
    // These must be preserved even if the frontend didn't include them.
    const committedDbKeys = await this.getCommittedTemplateKeys(userId);

    // Merge: incoming slots + committed slots not already in payload
    const payloadKeys = new Set(dbSlots.map((s) => `${s.dayOfWeek}:${s.hour}`));
    const preservedSlots = committedDbKeys
      .filter((k) => !payloadKeys.has(`${k.dayOfWeek}:${k.hour}`))
      .map((k) => ({ dayOfWeek: k.dayOfWeek, hour: k.hour }));

    const mergedDbSlots = [...dbSlots, ...preservedSlots];

    await this.db.transaction(async (tx) => {
      // Delete all existing template slots
      await tx
        .delete(schema.gameTimeTemplates)
        .where(eq(schema.gameTimeTemplates.userId, userId));

      // Bulk insert new slots (if any)
      if (mergedDbSlots.length > 0) {
        const now = new Date();
        await tx.insert(schema.gameTimeTemplates).values(
          mergedDbSlots.map((s) => ({
            userId,
            dayOfWeek: s.dayOfWeek,
            startHour: s.hour,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    });

    // Return all slots in display convention (convert preserved slots back)
    const preservedDisplay = preservedSlots.map((s) => ({
      dayOfWeek: (s.dayOfWeek + 1) % 7,
      hour: s.hour,
    }));
    return { slots: [...slots, ...preservedDisplay] };
  }

  /**
   * Get template slot keys (DB convention: 0=Mon) that overlap with active
   * event signups in the current or next week. Used by saveTemplate to
   * preserve committed slots server-side.
   */
  private async getCommittedTemplateKeys(
    userId: number,
  ): Promise<Array<{ dayOfWeek: number; hour: number }>> {
    // Get existing template slots
    const existingSlots = await this.db
      .select({
        dayOfWeek: schema.gameTimeTemplates.dayOfWeek,
        startHour: schema.gameTimeTemplates.startHour,
      })
      .from(schema.gameTimeTemplates)
      .where(eq(schema.gameTimeTemplates.userId, userId));

    if (existingSlots.length === 0) return [];

    // Query event signups for this user within the next 2 weeks
    const now = new Date();
    const twoWeeksLater = new Date(now);
    twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
    const rangeStr = `[${now.toISOString()},${twoWeeksLater.toISOString()})`;

    const signedUpEvents = await this.db
      .select({ duration: schema.events.duration })
      .from(schema.eventSignups)
      .innerJoin(
        schema.events,
        eq(schema.eventSignups.eventId, schema.events.id),
      )
      .where(
        and(
          eq(schema.eventSignups.userId, userId),
          sql`${schema.events.duration} && ${rangeStr}::tsrange`,
        ),
      );

    if (signedUpEvents.length === 0) return [];

    // Convert event durations to day-of-week + hour keys (DB convention: 0=Mon)
    const committedKeys = new Set<string>();
    for (const event of signedUpEvents) {
      const [eventStart, eventEnd] = event.duration;
      const cursor = new Date(eventStart);
      cursor.setUTCMinutes(0, 0, 0);
      if (cursor < eventStart) cursor.setUTCHours(cursor.getUTCHours() + 1);

      while (cursor < eventEnd) {
        // Convert UTC day to DB convention (0=Mon): getUTCDay() returns 0=Sun
        const utcDay = cursor.getUTCDay();
        const dbDay = (utcDay + 6) % 7; // 0=Sun → 6, 1=Mon → 0, etc.
        committedKeys.add(`${dbDay}:${cursor.getUTCHours()}`);
        cursor.setUTCHours(cursor.getUTCHours() + 1);
      }
    }

    // Return only existing template slots that overlap with committed events
    return existingSlots
      .filter((s) => committedKeys.has(`${s.dayOfWeek}:${s.startHour}`))
      .map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.startHour }));
  }

  /**
   * Save per-hour date-specific overrides (upsert).
   * Batches all overrides into a single transaction to avoid N+1 round-trips.
   */
  async saveOverrides(
    userId: number,
    overrides: Array<{ date: string; hour: number; status: string }>,
  ): Promise<void> {
    if (overrides.length === 0) return;

    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const override of overrides) {
        await tx
          .insert(schema.gameTimeOverrides)
          .values({
            userId,
            date: override.date,
            hour: override.hour,
            status: override.status,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.gameTimeOverrides.userId,
              schema.gameTimeOverrides.date,
              schema.gameTimeOverrides.hour,
            ],
            set: {
              status: override.status,
              updatedAt: now,
            },
          });
      }
    });
  }

  /**
   * Create an absence range.
   */
  async createAbsence(
    userId: number,
    input: { startDate: string; endDate: string; reason?: string },
  ): Promise<AbsenceRecord> {
    const now = new Date();
    const [row] = await this.db
      .insert(schema.gameTimeAbsences)
      .values({
        userId,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: schema.gameTimeAbsences.id,
        startDate: schema.gameTimeAbsences.startDate,
        endDate: schema.gameTimeAbsences.endDate,
        reason: schema.gameTimeAbsences.reason,
      });

    return row;
  }

  /**
   * Delete an absence.
   */
  async deleteAbsence(userId: number, absenceId: number): Promise<void> {
    await this.db
      .delete(schema.gameTimeAbsences)
      .where(
        and(
          eq(schema.gameTimeAbsences.id, absenceId),
          eq(schema.gameTimeAbsences.userId, userId),
        ),
      );
  }

  /**
   * Get all absences for a user.
   */
  async getAbsences(userId: number): Promise<AbsenceRecord[]> {
    const rows = await this.db
      .select({
        id: schema.gameTimeAbsences.id,
        startDate: schema.gameTimeAbsences.startDate,
        endDate: schema.gameTimeAbsences.endDate,
        reason: schema.gameTimeAbsences.reason,
      })
      .from(schema.gameTimeAbsences)
      .where(eq(schema.gameTimeAbsences.userId, userId));

    return rows;
  }

  /**
   * Get composite view: merge template with event commitments, overrides, and absences for a given week.
   * Returns slots with status indicating whether the user is available or committed.
   * @param tzOffset Minutes offset from UTC (e.g., -480 for PST/UTC-8). Used to convert
   *                 UTC event times into the user's local day-of-week + hour for grid overlay.
   */
  async getCompositeView(
    userId: number,
    weekStart: Date,
    tzOffset = 0,
  ): Promise<{
    slots: CompositeSlot[];
    events: EventBlockDescriptor[];
    weekStart: string;
    overrides: OverrideRecord[];
    absences: AbsenceRecord[];
  }> {
    // 1. Fetch template slots (DB stores 0=Mon, convert to 0=Sun for display)
    const template = await this.getTemplate(userId);
    const remappedTemplateSlots = template.slots.map((s) => ({
      ...s,
      dayOfWeek: (s.dayOfWeek + 1) % 7, // DB 0=Mon -> display 0=Sun
    }));
    const templateSet = new Set(
      remappedTemplateSlots.map((s) => `${s.dayOfWeek}:${s.hour}`),
    );

    // 2. Query event signups for this user in the given week (with game data + creator)
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekRange = `[${weekStart.toISOString()},${weekEnd.toISOString()})`;

    const signedUpEvents = await this.db
      .select({
        eventId: schema.events.id,
        title: schema.events.title,
        description: schema.events.description,
        duration: schema.events.duration,
        signupId: schema.eventSignups.id,
        confirmationStatus: schema.eventSignups.confirmationStatus,
        registryId: schema.gameRegistry.id,
        registrySlug: schema.gameRegistry.slug,
        registryName: schema.gameRegistry.name,
        registryIconUrl: schema.gameRegistry.iconUrl,
        gameSlug: schema.games.slug,
        gameName: schema.games.name,
        gameCoverUrl: schema.games.coverUrl,
        creatorId: schema.events.creatorId,
        creatorUsername: schema.users.username,
      })
      .from(schema.eventSignups)
      .innerJoin(
        schema.events,
        eq(schema.eventSignups.eventId, schema.events.id),
      )
      .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
      .leftJoin(
        schema.games,
        eq(schema.events.gameId, sql`${schema.games.igdbId}::text`),
      )
      .leftJoin(
        schema.gameRegistry,
        eq(schema.events.registryGameId, schema.gameRegistry.id),
      )
      .where(
        and(
          eq(schema.eventSignups.userId, userId),
          sql`${schema.events.duration} && ${weekRange}::tsrange`,
        ),
      );

    // 2b. Batch-fetch signups preview for all events
    const eventIds = [...new Set(signedUpEvents.map((e) => e.eventId))];
    const signupsMap = new Map<
      number,
      {
        preview: Array<{
          id: number;
          username: string;
          avatar: string | null;
          characters?: Array<{ gameId: string; avatarUrl: string | null }>;
        }>;
        count: number;
      }
    >();

    if (eventIds.length > 0) {
      // Batch-fetch all signups for all events in 2 queries (preview + counts)
      const allSignups = await this.db
        .select({
          eventId: schema.eventSignups.eventId,
          signupId: schema.eventSignups.id,
          userId: schema.eventSignups.userId,
          username: schema.users.username,
          avatar: schema.users.avatar,
          // Window function: row number per event for LIMIT 6 in JS
          rowNum:
            sql<number>`ROW_NUMBER() OVER (PARTITION BY ${schema.eventSignups.eventId} ORDER BY ${schema.eventSignups.id})`.as(
              'row_num',
            ),
        })
        .from(schema.eventSignups)
        .innerJoin(
          schema.users,
          eq(schema.eventSignups.userId, schema.users.id),
        )
        .where(inArray(schema.eventSignups.eventId, eventIds));

      const allCounts = await this.db
        .select({
          eventId: schema.eventSignups.eventId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.eventSignups)
        .where(inArray(schema.eventSignups.eventId, eventIds))
        .groupBy(schema.eventSignups.eventId);

      const countMap = new Map(allCounts.map((c) => [c.eventId, c.count]));
      const allSignupUsers: number[] = [];

      for (const eventId of eventIds) {
        const eventSignups = allSignups.filter(
          (s) => s.eventId === eventId && s.rowNum <= 6,
        );
        for (const s of eventSignups) allSignupUsers.push(s.userId);
        signupsMap.set(eventId, {
          preview: eventSignups.map((s) => ({
            id: s.userId,
            username: s.username,
            avatar: s.avatar,
          })),
          count: countMap.get(eventId) ?? 0,
        });
      }

      // Fetch characters for all signup users (for avatar resolution)
      const uniqueUserIds = [...new Set(allSignupUsers)];
      if (uniqueUserIds.length > 0) {
        const charactersData = await this.db
          .select({
            userId: schema.characters.userId,
            gameId: schema.characters.gameId,
            avatarUrl: schema.characters.avatarUrl,
          })
          .from(schema.characters)
          .where(inArray(schema.characters.userId, uniqueUserIds));

        const charactersByUser = new Map<
          number,
          Array<{ gameId: string; avatarUrl: string | null }>
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

        // Attach characters to each signup preview entry
        for (const entry of signupsMap.values()) {
          for (const signup of entry.preview) {
            const chars = charactersByUser.get(signup.id);
            if (chars) signup.characters = chars;
          }
        }
      }
    }

    // 3. Fetch overrides for this week's date range
    // Wrapped in try-catch: tables may not exist if migration 0019 hasn't been applied yet
    const weekStartDate = weekStart.toISOString().split('T')[0];
    const weekEndDate = new Date(weekEnd.getTime() - 1)
      .toISOString()
      .split('T')[0];

    let overrideRows: OverrideRecord[] = [];
    try {
      overrideRows = await this.db
        .select({
          date: schema.gameTimeOverrides.date,
          hour: schema.gameTimeOverrides.hour,
          status: schema.gameTimeOverrides.status,
        })
        .from(schema.gameTimeOverrides)
        .where(
          and(
            eq(schema.gameTimeOverrides.userId, userId),
            gte(schema.gameTimeOverrides.date, weekStartDate),
            lte(schema.gameTimeOverrides.date, weekEndDate),
          ),
        );
    } catch (err: unknown) {
      // Table doesn't exist yet (42P01) — gracefully degrade; re-throw other errors
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '42P01'
      ) {
        // relation does not exist — migration not applied yet
      } else {
        throw err;
      }
    }

    // 4. Fetch absences that overlap this week
    let absenceRows: AbsenceRecord[] = [];
    try {
      absenceRows = await this.db
        .select({
          id: schema.gameTimeAbsences.id,
          startDate: schema.gameTimeAbsences.startDate,
          endDate: schema.gameTimeAbsences.endDate,
          reason: schema.gameTimeAbsences.reason,
        })
        .from(schema.gameTimeAbsences)
        .where(
          and(
            eq(schema.gameTimeAbsences.userId, userId),
            lte(schema.gameTimeAbsences.startDate, weekEndDate),
            gte(schema.gameTimeAbsences.endDate, weekStartDate),
          ),
        );
    } catch (err: unknown) {
      // Table doesn't exist yet (42P01) — gracefully degrade; re-throw other errors
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '42P01'
      ) {
        // relation does not exist — migration not applied yet
      } else {
        throw err;
      }
    }

    // Build absence date set for quick lookup
    const absenceDates = new Set<string>();
    for (const absence of absenceRows) {
      const start = new Date(absence.startDate);
      const end = new Date(absence.endDate);
      const cursor = new Date(start);
      while (cursor <= end) {
        absenceDates.add(cursor.toISOString().split('T')[0]);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    // Build override map for quick lookup
    const overrideMap = new Map<string, string>();
    for (const o of overrideRows) {
      overrideMap.set(`${o.date}:${o.hour}`, o.status);
    }

    // 5. Convert event durations to day-of-week + hour cells relative to weekStart
    // Now weekStart is Sunday, so dayDiff=0 is Sunday (display day 0)
    const committedSet = new Set<string>();

    for (const event of signedUpEvents) {
      const [eventStart, eventEnd] = event.duration;
      const clampedStart = eventStart < weekStart ? weekStart : eventStart;
      const clampedEnd = eventEnd > weekEnd ? weekEnd : eventEnd;

      const cursor = new Date(clampedStart);
      cursor.setUTCMinutes(0, 0, 0);
      if (cursor < clampedStart) {
        cursor.setUTCHours(cursor.getUTCHours() + 1);
      }

      while (cursor < clampedEnd) {
        const localMs = cursor.getTime() - tzOffset * 60 * 1000;
        const localDate = new Date(localMs);
        const weekStartLocalMs = weekStart.getTime() - tzOffset * 60 * 1000;
        const dayDiff = Math.floor(
          (localMs - weekStartLocalMs) / (1000 * 60 * 60 * 24),
        );
        if (dayDiff >= 0 && dayDiff < 7) {
          committedSet.add(`${dayDiff}:${localDate.getUTCHours()}`);
        }
        cursor.setUTCHours(cursor.getUTCHours() + 1);
      }
    }

    // 6. Build merged slot array with priority: absence > override > template > event
    const slots: CompositeSlot[] = [];

    // Add all template slots (now in display convention 0=Sun)
    for (const s of remappedTemplateSlots) {
      const key = `${s.dayOfWeek}:${s.hour}`;

      // Check if this day is in an absence
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + s.dayOfWeek);
      const dateStr = dayDate.toISOString().split('T')[0];

      if (absenceDates.has(dateStr)) {
        slots.push({
          dayOfWeek: s.dayOfWeek,
          hour: s.hour,
          status: 'blocked',
          fromTemplate: true,
        });
      } else {
        // Check override
        const overrideKey = `${dateStr}:${s.hour}`;
        const overrideStatus = overrideMap.get(overrideKey);
        if (overrideStatus) {
          slots.push({
            dayOfWeek: s.dayOfWeek,
            hour: s.hour,
            status: overrideStatus as CompositeSlot['status'],
            fromTemplate: true,
          });
        } else {
          slots.push({
            dayOfWeek: s.dayOfWeek,
            hour: s.hour,
            status: committedSet.has(key) ? 'committed' : 'available',
            fromTemplate: true,
          });
        }
      }
    }

    // Add committed slots that are NOT in the template (off-hours events)
    for (const key of committedSet) {
      if (!templateSet.has(key)) {
        const [day, hour] = key.split(':').map(Number);
        slots.push({
          dayOfWeek: day,
          hour,
          status: 'committed',
          fromTemplate: false,
        });
      }
    }

    // 7. Build event block descriptors (per-day blocks with startHour/endHour)
    const eventBlocks: EventBlockDescriptor[] = [];

    for (const event of signedUpEvents) {
      const [eventStart, eventEnd] = event.duration;
      const clampedStart = eventStart < weekStart ? weekStart : eventStart;
      const clampedEnd = eventEnd > weekEnd ? weekEnd : eventEnd;

      const gameSlug = event.registrySlug ?? event.gameSlug ?? null;
      const gameName = event.registryName ?? event.gameName ?? null;
      const coverUrl = event.gameCoverUrl ?? event.registryIconUrl ?? null;

      const dayHours = new Map<number, number[]>();

      const cursor = new Date(clampedStart);
      cursor.setUTCMinutes(0, 0, 0);
      if (cursor < clampedStart) {
        cursor.setUTCHours(cursor.getUTCHours() + 1);
      }

      while (cursor < clampedEnd) {
        const localMs = cursor.getTime() - tzOffset * 60 * 1000;
        const localDate = new Date(localMs);
        const weekStartLocalMs = weekStart.getTime() - tzOffset * 60 * 1000;
        const dayDiff = Math.floor(
          (localMs - weekStartLocalMs) / (1000 * 60 * 60 * 24),
        );
        if (dayDiff >= 0 && dayDiff < 7) {
          const hours = dayHours.get(dayDiff) ?? [];
          hours.push(localDate.getUTCHours());
          dayHours.set(dayDiff, hours);
        }
        cursor.setUTCHours(cursor.getUTCHours() + 1);
      }

      const signupsData = signupsMap.get(event.eventId);

      for (const [dayOfWeek, hours] of dayHours) {
        if (hours.length === 0) continue;
        hours.sort((a, b) => a - b);
        eventBlocks.push({
          eventId: event.eventId,
          title: event.title,
          gameSlug,
          gameName,
          gameRegistryId: event.registryId ?? null,
          coverUrl,
          signupId: event.signupId,
          confirmationStatus: event.confirmationStatus as
            | 'pending'
            | 'confirmed'
            | 'changed',
          dayOfWeek,
          startHour: hours[0],
          endHour: hours[hours.length - 1] + 1,
          description: event.description ?? null,
          creatorUsername: event.creatorUsername ?? null,
          signupsPreview: signupsData?.preview ?? [],
          signupCount: signupsData?.count ?? 0,
        });
      }
    }

    return {
      slots,
      events: eventBlocks,
      weekStart: weekStart.toISOString(),
      overrides: overrideRows,
      absences: absenceRows,
    };
  }
}
