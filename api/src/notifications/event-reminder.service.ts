import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { RoleGapAlertService } from './role-gap-alert.service';

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
    private readonly roleGapAlertService: RoleGapAlertService,
  ) {}

  // Stagger: offset to second 20 to avoid collision with EventAutoExtend at second 0 (ROK-606).
  @Cron('20 */1 * * * *', { name: 'EventReminderService_handleReminders' })
  async handleReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EventReminderService_handleReminders',
      async () => {
        this.logger.debug('Running event reminder check...');
        const now = new Date();

        const lowerBound = new Date(now.getTime() - 90_000);
        const upperBound = new Date(now.getTime() + 24 * 60 * 60 * 1000);

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
          .where(
            and(
              isNull(schema.events.cancelledAt),
              sql`lower(${schema.events.duration}) >= ${lowerBound.toISOString()}::timestamptz`,
              sql`lower(${schema.events.duration}) <= ${upperBound.toISOString()}::timestamptz`,
            ),
          );

        const defaultTimezone =
          (await this.settingsService.getDefaultTimezone()) ?? 'UTC';

        for (const window of REMINDER_WINDOWS) {
          const eventsInWindow = candidateEvents.filter((event) => {
            if (!event[window.fieldKey]) return false;
            const msUntil = event.duration[0].getTime() - now.getTime();
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
            defaultTimezone,
          );
        }

        await this.roleGapAlertService.checkRoleGaps(now, defaultTimezone);
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
    defaultTimezone: string,
  ): Promise<void> {
    const eventIds = events.map((e) => e.id);

    const signups = await this.db
      .select({
        eventId: schema.eventSignups.eventId,
        userId: schema.eventSignups.userId,
      })
      .from(schema.eventSignups)
      .where(inArray(schema.eventSignups.eventId, eventIds));

    const signupsByEvent = new Map<number, number[]>();
    for (const signup of signups) {
      if (signup.userId === null) continue;
      if (!signupsByEvent.has(signup.eventId))
        signupsByEvent.set(signup.eventId, []);
      signupsByEvent.get(signup.eventId)!.push(signup.userId);
    }

    const allUserIds = [...new Set(Array.from(signupsByEvent.values()).flat())];
    if (allUserIds.length === 0) return;

    const users = await this.db
      .select({ id: schema.users.id, discordId: schema.users.discordId })
      .from(schema.users)
      .where(inArray(schema.users.id, allUserIds));
    const userMap = new Map(users.map((u) => [u.id, u]));

    const userTimezones = await this.getUserTimezones(allUserIds);
    const tzMap = new Map(userTimezones.map((ut) => [ut.userId, ut.timezone]));

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

    const charsByUser = new Map<number, typeof characters>();
    for (const char of characters) {
      if (!charsByUser.has(char.userId)) charsByUser.set(char.userId, []);
      charsByUser.get(char.userId)!.push(char);
    }

    for (const event of events) {
      const userIds = signupsByEvent.get(event.id) ?? [];
      const startTime = event.duration[0];
      const minutesUntil = Math.max(
        0,
        Math.round((startTime.getTime() - now.getTime()) / 60000),
      );
      const discordUrl = await this.notificationService.getDiscordEmbedUrl(
        event.id,
      );
      const voiceChannelId =
        await this.notificationService.resolveVoiceChannelId(event.gameId);

      for (const userId of userIds) {
        const user = userMap.get(userId);
        if (!user) continue;

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
          defaultTimezone,
          discordUrl,
          voiceChannelId,
        });
      }
    }
  }

  /**
   * Send a single reminder notification with duplicate prevention.
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
    defaultTimezone?: string;
    discordUrl?: string | null;
    voiceChannelId?: string | null;
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

    if (result.length === 0) return false;

    const timezone = input.timezone ?? input.defaultTimezone ?? 'UTC';
    const timeStr = input.startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
      timeZone: timezone,
    });

    const messageText = this.buildReminderMessage(
      input.title,
      timeStr,
      input.minutesUntil,
    );
    const discordUrl = input.discordUrl ?? null;
    const voiceChannelId = input.voiceChannelId ?? null;
    const titleTimeLabel = this.buildTitleTimeLabel(input.minutesUntil);

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

  private buildReminderMessage(
    eventTitle: string,
    timeStr: string,
    minutesUntil: number,
  ): string {
    if (minutesUntil <= 1) return `${eventTitle} is starting now!`;
    if (minutesUntil <= 60)
      return `${eventTitle} starts in ${minutesUntil} minutes at ${timeStr}.`;
    const hours = Math.round(minutesUntil / 60);
    if (hours === 1) return `${eventTitle} starts in 1 hour at ${timeStr}.`;
    return `${eventTitle} starts in ${hours} hours at ${timeStr}.`;
  }

  async getUserTimezones(
    userIds?: number[],
  ): Promise<{ userId: number; timezone: string }[]> {
    const conditions = [eq(schema.userPreferences.key, 'timezone')];
    if (userIds && userIds.length > 0) {
      conditions.push(inArray(schema.userPreferences.userId, userIds));
    }

    const rows = await this.db
      .select({
        userId: schema.userPreferences.userId,
        value: schema.userPreferences.value,
      })
      .from(schema.userPreferences)
      .where(and(...conditions));

    return rows.map((row) => {
      const tz = row.value as string;
      return { userId: row.userId, timezone: tz && tz !== 'auto' ? tz : 'UTC' };
    });
  }

  private buildTitleTimeLabel(minutesUntil: number): string {
    if (minutesUntil <= 1) return 'Now';
    if (minutesUntil <= 60) return `in ${minutesUntil} Minutes`;
    const hours = Math.round(minutesUntil / 60);
    if (hours === 1) return 'in 1 Hour';
    return `in ${hours} Hours`;
  }
}
