import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

/** Hour (0-23) at which day-of reminders fire in the user's local timezone */
const DAY_OF_HOUR = 9;

interface UserTimezone {
  userId: number;
  timezone: string;
}

/**
 * Scheduled service that sends event reminders (ROK-185).
 *
 * Two reminder types:
 * - **day_of**: Fires at 9am in each user's local timezone on the day of an event
 * - **starting_soon**: Fires ~30 minutes before event start
 *
 * Duplicate prevention uses the `event_reminders_sent` table with a unique
 * constraint + ON CONFLICT DO NOTHING for atomic idempotency.
 */
@Injectable()
export class EventReminderService {
  private readonly logger = new Logger(EventReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * Day-of reminder cron: runs every 15 minutes.
   * Checks if it's currently the target hour (9am) in each signed-up user's timezone.
   * If so, sends a day-of reminder for every event they're signed up for today.
   */
  @Cron('0 */15 * * * *', { name: 'EventReminderService_handleDayOfReminders' })
  async handleDayOfReminders() {
    await this.cronJobService.executeWithTracking(
      'EventReminderService_handleDayOfReminders',
      async () => {
        this.logger.debug('Running day-of reminder check...');

        const userTimezones = await this.getUserTimezones();
        if (userTimezones.length === 0) return;

        const now = new Date();

        // Find users whose local time is currently in the target hour
        const eligibleUserIds: number[] = [];
        for (const { userId, timezone } of userTimezones) {
          if (this.isTargetHour(now, timezone, DAY_OF_HOUR)) {
            eligibleUserIds.push(userId);
          }
        }

        if (eligibleUserIds.length === 0) return;

        this.logger.debug(
          `Day-of: ${eligibleUserIds.length} users at target hour`,
        );

        // For each eligible user, find events today in their timezone that they're signed up for
        for (const { userId, timezone } of userTimezones) {
          if (!eligibleUserIds.includes(userId)) continue;

          const todayRange = this.getTodayRange(now, timezone);
          await this.sendDayOfRemindersForUser(
            userId,
            todayRange.start,
            todayRange.end,
          );
        }
      },
    );
  }

  /**
   * Starting-soon reminder cron: runs every 5 minutes.
   * Sends reminders for events starting within the next 35 minutes.
   *
   * Uses schema-level selection (which goes through Drizzle's fromDriver for
   * proper tsrange→Date conversion) then filters in JS, avoiding timezone
   * mismatches from raw SQL `lower(duration)` strings.
   */
  @Cron('0 */5 * * * *', {
    name: 'EventReminderService_handleStartingSoonReminders',
  })
  async handleStartingSoonReminders() {
    await this.cronJobService.executeWithTracking(
      'EventReminderService_handleStartingSoonReminders',
      async () => {
        this.logger.debug('Running starting-soon reminder check...');

        const now = new Date();
        const windowMs = 35 * 60 * 1000; // 35 minutes

        // Fetch all events and filter in JS.
        const candidateEvents = await this.db
          .select({
            id: schema.events.id,
            title: schema.events.title,
            duration: schema.events.duration,
          })
          .from(schema.events);

        // Filter precisely in JS using fromDriver-converted Dates
        const upcomingEvents = candidateEvents.filter((event) => {
          const startTime = event.duration[0];
          const msUntil = startTime.getTime() - now.getTime();
          return msUntil >= 0 && msUntil <= windowMs;
        });

        if (upcomingEvents.length === 0) return;

        this.logger.debug(
          `Starting-soon: ${upcomingEvents.length} events in window`,
        );

        const eventIds = upcomingEvents.map((e) => e.id);

        // Get all signups for these events
        const signups = await this.db
          .select({
            eventId: schema.eventSignups.eventId,
            userId: schema.eventSignups.userId,
          })
          .from(schema.eventSignups)
          .where(inArray(schema.eventSignups.eventId, eventIds));

        // Group signups by event
        const signupsByEvent = new Map<number, number[]>();
        for (const signup of signups) {
          if (!signupsByEvent.has(signup.eventId)) {
            signupsByEvent.set(signup.eventId, []);
          }
          signupsByEvent.get(signup.eventId)!.push(signup.userId);
        }

        // Send reminders
        for (const event of upcomingEvents) {
          const userIds = signupsByEvent.get(event.id) ?? [];
          const startTime = event.duration[0];
          const minutesUntil = Math.round(
            (startTime.getTime() - now.getTime()) / 60000,
          );

          for (const userId of userIds) {
            await this.sendReminder({
              eventId: event.id,
              userId,
              reminderType: 'starting_soon',
              title: `${event.title} starting soon`,
              message: `${event.title} starts in about ${minutesUntil} minutes.`,
            });
          }
        }
      },
    );
  }

  /**
   * Send a reminder notification with duplicate prevention.
   * Inserts a tracking row with ON CONFLICT DO NOTHING — if the row already
   * exists (duplicate), the insert returns empty and we skip the notification.
   */
  async sendReminder(input: {
    eventId: number;
    userId: number;
    reminderType: string;
    title: string;
    message: string;
  }): Promise<boolean> {
    const result = await this.db
      .insert(schema.eventRemindersSent)
      .values({
        eventId: input.eventId,
        userId: input.userId,
        reminderType: input.reminderType,
      })
      .onConflictDoNothing({
        target: [
          schema.eventRemindersSent.eventId,
          schema.eventRemindersSent.userId,
          schema.eventRemindersSent.reminderType,
        ],
      })
      .returning();

    if (result.length === 0) {
      // Already sent — duplicate
      return false;
    }

    await this.notificationService.create({
      userId: input.userId,
      type: 'event_reminder',
      title: input.title,
      message: input.message,
      payload: { eventId: input.eventId },
    });

    return true;
  }

  /**
   * Batch query user timezone preferences.
   * Users with 'auto' or no timezone fall back to UTC.
   */
  async getUserTimezones(): Promise<UserTimezone[]> {
    const rows = await this.db
      .select({
        userId: schema.userPreferences.userId,
        value: schema.userPreferences.value,
      })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.key, 'timezone'));

    return rows.map((row) => {
      const tz = row.value as string;
      return {
        userId: row.userId,
        timezone: tz && tz !== 'auto' ? tz : 'UTC',
      };
    });
  }

  /**
   * Check if the current time in the given timezone is at the target hour.
   * Uses a 15-minute window to account for cron interval.
   */
  private isTargetHour(
    now: Date,
    timezone: string,
    targetHour: number,
  ): boolean {
    try {
      const localTime = new Date(
        now.toLocaleString('en-US', { timeZone: timezone }),
      );
      return localTime.getHours() === targetHour && localTime.getMinutes() < 15;
    } catch {
      // Invalid timezone — fall back to UTC
      const utcHour = now.getUTCHours();
      return utcHour === targetHour && now.getUTCMinutes() < 15;
    }
  }

  /**
   * Get the start and end of "today" in a given timezone, as UTC Date objects.
   */
  private getTodayRange(
    now: Date,
    timezone: string,
  ): { start: Date; end: Date } {
    try {
      // Get the local date string in the user's timezone
      const localDateStr = now.toLocaleDateString('en-CA', {
        timeZone: timezone,
      }); // YYYY-MM-DD
      // Create start/end of day in the user's timezone
      const startLocal = new Date(`${localDateStr}T00:00:00`);
      const endLocal = new Date(`${localDateStr}T23:59:59.999`);

      // Convert back to UTC by getting the offset
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset',
      });
      const parts = formatter.formatToParts(now);
      const offsetPart = parts.find((p) => p.type === 'timeZoneName');
      const offsetStr = offsetPart?.value ?? 'GMT';

      // Parse offset like "GMT-5" or "GMT+5:30"
      const offsetMatch = offsetStr.match(/GMT([+-]?)(\d+)?(?::(\d+))?/);
      let offsetMinutes = 0;
      if (offsetMatch) {
        const sign = offsetMatch[1] === '-' ? -1 : 1;
        const hours = parseInt(offsetMatch[2] || '0', 10);
        const minutes = parseInt(offsetMatch[3] || '0', 10);
        offsetMinutes = sign * (hours * 60 + minutes);
      }

      return {
        start: new Date(startLocal.getTime() - offsetMinutes * 60000),
        end: new Date(endLocal.getTime() - offsetMinutes * 60000),
      };
    } catch {
      // Fallback to UTC today
      const utcDateStr = now.toISOString().slice(0, 10);
      return {
        start: new Date(`${utcDateStr}T00:00:00Z`),
        end: new Date(`${utcDateStr}T23:59:59.999Z`),
      };
    }
  }

  /**
   * Send day-of reminders for a single user.
   * Finds all events the user is signed up for that start within the given range.
   * Uses schema-level selection for proper tsrange→Date conversion.
   */
  private async sendDayOfRemindersForUser(
    userId: number,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<void> {
    // Find events this user is signed up for.
    // No SQL-level time filter — tsrange fromDriver timezone interpretation makes
    // SQL comparisons unreliable. JS filtering on converted Dates is correct.
    const userEvents = await this.db
      .select({
        eventId: schema.events.id,
        title: schema.events.title,
        duration: schema.events.duration,
      })
      .from(schema.eventSignups)
      .innerJoin(
        schema.events,
        eq(schema.eventSignups.eventId, schema.events.id),
      )
      .where(eq(schema.eventSignups.userId, userId));

    // Filter in JS using fromDriver-converted Dates
    const todayEvents = userEvents.filter((row) => {
      const startTime = row.duration[0];
      return startTime >= rangeStart && startTime <= rangeEnd;
    });

    for (const row of todayEvents) {
      const startTime = row.duration[0];
      const timeStr = startTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      await this.sendReminder({
        eventId: row.eventId,
        userId,
        reminderType: 'day_of',
        title: `${row.title} is today`,
        message: `${row.title} is scheduled for today at ${timeStr}.`,
      });
    }
  }
}
