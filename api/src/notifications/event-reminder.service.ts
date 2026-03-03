import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, inArray, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Reminder window definitions (ROK-126).
 * Each window has a type key, a label for the embed, and the number of
 * milliseconds before event start at which the reminder fires.
 */
const REMINDER_WINDOWS = [
  {
    type: '15min',
    label: '15 Minutes',
    ms: 15 * 60 * 1000,
    fieldKey: 'reminder15min' as const,
  },
  {
    type: '1hour',
    label: '1 Hour',
    ms: 60 * 60 * 1000,
    fieldKey: 'reminder1hour' as const,
  },
  {
    type: '24hour',
    label: '24 Hours',
    ms: 24 * 60 * 60 * 1000,
    fieldKey: 'reminder24hour' as const,
  },
] as const;

type ReminderWindowType = (typeof REMINDER_WINDOWS)[number]['type'];

/**
 * Scheduled service that sends event reminders via Discord DM (ROK-126).
 *
 * Runs every 60 seconds, checking for events that fall within each
 * configured reminder window. Uses the `event_reminders_sent` table
 * with a unique constraint for idempotent duplicate prevention.
 *
 * Replaces the earlier ROK-185 day-of / starting-soon approach with
 * per-event configurable 15min / 1hour / 24hour windows.
 */
@Injectable()
export class EventReminderService {
  private readonly logger = new Logger(EventReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly cronJobService: CronJobService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Main cron: runs every 60 seconds (ROK-126 AC-1).
   * For each reminder window, finds events whose start time is within the
   * window and sends DM reminders to all confirmed attendees with Discord linked.
   */
  // Stagger: offset to second 20 to avoid collision with EventAutoExtend at second 0 (ROK-606).
  @Cron('20 */1 * * * *', { name: 'EventReminderService_handleReminders' })
  async handleReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EventReminderService_handleReminders',
      async () => {
        this.logger.debug('Running event reminder check...');

        const now = new Date();

        // Fetch all non-cancelled future events (using schema-level read for proper tsrange→Date).
        // Include reminder config columns to know which windows are enabled per event.
        const candidateEvents = await this.db
          .select({
            id: schema.events.id,
            title: schema.events.title,
            duration: schema.events.duration,
            gameId: schema.events.gameId,
            reminder15min: schema.events.reminder15min,
            reminder1hour: schema.events.reminder1hour,
            reminder24hour: schema.events.reminder24hour,
            cancelledAt: schema.events.cancelledAt,
          })
          .from(schema.events)
          .where(isNull(schema.events.cancelledAt));

        // For each reminder window, find events in that window
        for (const window of REMINDER_WINDOWS) {
          const eventsInWindow = candidateEvents.filter((event) => {
            // Check if this window is enabled for this event
            if (!event[window.fieldKey]) return false;

            const startTime = event.duration[0];
            const msUntil = startTime.getTime() - now.getTime();
            // Fire if event starts within [0, window.ms] from now
            // Use a small buffer (90s) to handle cron timing jitter
            return msUntil >= -90_000 && msUntil <= window.ms;
          });

          if (eventsInWindow.length === 0) continue;

          this.logger.debug(
            `${window.type}: ${eventsInWindow.length} events in window`,
          );

          await this.sendRemindersForWindow(
            eventsInWindow,
            window.type,
            window.label,
            now,
          );
        }
      },
    );
  }

  /**
   * Send reminders for all events in a specific window.
   */
  private async sendRemindersForWindow(
    events: {
      id: number;
      title: string;
      duration: [Date, Date];
      gameId: number | null;
    }[],
    windowType: ReminderWindowType,
    windowLabel: string,
    now: Date,
  ): Promise<void> {
    const eventIds = events.map((e) => e.id);

    // Get all signups for these events (RL members only — filter out anonymous)
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
      if (signup.userId === null) continue; // Skip anonymous Discord participants
      if (!signupsByEvent.has(signup.eventId)) {
        signupsByEvent.set(signup.eventId, []);
      }
      signupsByEvent.get(signup.eventId)!.push(signup.userId);
    }

    // Collect all unique user IDs for batch character + user info lookup
    const allUserIds = [...new Set(Array.from(signupsByEvent.values()).flat())];

    if (allUserIds.length === 0) return;

    // Batch fetch user info (for Discord ID and character)
    const users = await this.db
      .select({
        id: schema.users.id,
        discordId: schema.users.discordId,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, allUserIds));

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Batch fetch per-user timezone preferences for time formatting (ROK-544)
    const userTimezones = await this.getUserTimezones();
    const tzMap = new Map(userTimezones.map((ut) => [ut.userId, ut.timezone]));

    // Batch fetch characters for signed-up users
    const characters =
      allUserIds.length > 0
        ? await this.db
            .select({
              userId: schema.characters.userId,
              name: schema.characters.name,
              charClass: schema.characters.class,
              gameId: schema.characters.gameId,
            })
            .from(schema.characters)
            .where(inArray(schema.characters.userId, allUserIds))
        : [];

    // Group characters by userId
    const charsByUser = new Map<number, typeof characters>();
    for (const char of characters) {
      if (!charsByUser.has(char.userId)) {
        charsByUser.set(char.userId, []);
      }
      charsByUser.get(char.userId)!.push(char);
    }

    // Send reminders per event, per user
    for (const event of events) {
      const userIds = signupsByEvent.get(event.id) ?? [];
      const startTime = event.duration[0];
      const minutesUntil = Math.max(
        0,
        Math.round((startTime.getTime() - now.getTime()) / 60000),
      );

      for (const userId of userIds) {
        const user = userMap.get(userId);
        if (!user) continue; // User not found — skip

        // Find user's character for this event's game
        const userChars = charsByUser.get(userId) ?? [];
        const matchingChar = event.gameId
          ? (userChars.find((c) => c.gameId === event.gameId) ?? userChars[0])
          : userChars[0];

        const charDisplay = matchingChar
          ? `${matchingChar.name}${matchingChar.charClass ? ` (${matchingChar.charClass})` : ''}`
          : null;

        await this.sendReminder({
          eventId: event.id,
          userId,
          windowType,
          windowLabel,
          title: event.title,
          startTime,
          minutesUntil,
          characterDisplay: charDisplay,
          timezone: tzMap.get(userId),
          gameId: event.gameId,
        });
      }
    }
  }

  /**
   * Send a single reminder notification with duplicate prevention.
   * Inserts a tracking row with ON CONFLICT DO NOTHING — if the row already
   * exists (duplicate), the insert returns empty and we skip the notification.
   */
  async sendReminder(input: {
    eventId: number;
    userId: number;
    windowType: ReminderWindowType;
    windowLabel: string;
    title: string;
    startTime: Date;
    minutesUntil: number;
    characterDisplay: string | null;
    timezone?: string;
    gameId?: number | null;
  }): Promise<boolean> {
    const result = await this.db
      .insert(schema.eventRemindersSent)
      .values({
        eventId: input.eventId,
        userId: input.userId,
        reminderType: input.windowType,
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

    // Resolve timezone: per-user preference → system default → UTC
    const timezone =
      input.timezone ??
      (await this.settingsService.getDefaultTimezone()) ??
      'UTC';

    // Build the time display string
    const timeStr = input.startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
      timeZone: timezone,
    });

    const messageText = this.buildReminderMessage(
      input.windowLabel,
      input.title,
      timeStr,
      input.minutesUntil,
    );

    // ROK-538: Look up Discord embed URL for the event
    const discordUrl = await this.notificationService.getDiscordEmbedUrl(
      input.eventId,
    );

    // ROK-507: Resolve voice channel for the event's game
    const voiceChannelId = await this.notificationService.resolveVoiceChannelId(
      input.gameId,
    );

    // Build a dynamic title that matches the body's time calculation
    const titleTimeLabel = this.buildTitleTimeLabel(input.minutesUntil);

    // Create in-app notification (this also dispatches to Discord DM via the standard pipeline)
    await this.notificationService.create({
      userId: input.userId,
      type: 'event_reminder',
      title: `Event Starting ${titleTimeLabel}!`,
      message: messageText,
      payload: {
        eventId: input.eventId,
        reminderWindow: input.windowType,
        characterDisplay: input.characterDisplay,
        startTime: input.startTime.toISOString(),
        ...(discordUrl ? { discordUrl } : {}),
        ...(voiceChannelId ? { voiceChannelId } : {}),
      },
    });

    return true;
  }

  /**
   * Build a human-readable reminder message.
   */
  private buildReminderMessage(
    windowLabel: string,
    eventTitle: string,
    timeStr: string,
    minutesUntil: number,
  ): string {
    if (minutesUntil <= 1) {
      return `${eventTitle} is starting now!`;
    }
    if (minutesUntil <= 60) {
      return `${eventTitle} starts in ${minutesUntil} minutes at ${timeStr}.`;
    }
    const hours = Math.round(minutesUntil / 60);
    if (hours === 1) {
      return `${eventTitle} starts in 1 hour at ${timeStr}.`;
    }
    return `${eventTitle} starts in ${hours} hours at ${timeStr}.`;
  }

  /**
   * Batch query user timezone preferences.
   */
  async getUserTimezones(): Promise<{ userId: number; timezone: string }[]> {
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
   * Build a human-readable time label for the notification title,
   * matching the body's time calculation so they always agree (ROK-647).
   */
  private buildTitleTimeLabel(minutesUntil: number): string {
    if (minutesUntil <= 1) return 'Now';
    if (minutesUntil <= 60) return `in ${minutesUntil} Minutes`;
    const hours = Math.round(minutesUntil / 60);
    if (hours === 1) return 'in 1 Hour';
    return `in ${hours} Hours`;
  }
}
