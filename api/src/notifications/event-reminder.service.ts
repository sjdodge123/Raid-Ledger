import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { RoleGapAlertService } from './role-gap-alert.service';
import {
  fetchSignupsByEvent,
  fetchUserMap,
  fetchCharactersByUser,
  fetchUserTimezones,
  buildCharDisplay,
  buildReminderPayload,
  buildReminderStrings,
} from './event-reminder.helpers';

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

type CharsByUserMap = Map<
  number,
  { userId: number; name: string; charClass: string | null; gameId: number }[]
>;

interface ReminderFetchContext {
  signupsByEvent: Map<number, number[]>;
  userMap: Map<number, { id: number; discordId: string | null }>;
  tzMap: Map<number, string>;
  charsByUser: CharsByUserMap;
}

/** Scheduled service that sends event reminders via Discord DM (ROK-126). */
@Injectable()
export class EventReminderService {
  private readonly logger = new Logger(EventReminderService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly cronJobService: CronJobService,
    private readonly settingsService: SettingsService,
    private readonly roleGapAlertService: RoleGapAlertService,
  ) {}

  @Cron('20 */1 * * * *', { name: 'EventReminderService_handleReminders' })
  async handleReminders(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EventReminderService_handleReminders',
      () => this.processReminderWindows(),
    );
  }

  /** Core reminder processing logic. */
  private async processReminderWindows(): Promise<void | false> {
    this.logger.debug('Running event reminder check...');
    const now = new Date();
    const candidateEvents = await this.fetchCandidateEvents(now);
    const defaultTimezone =
      (await this.settingsService.getDefaultTimezone()) ?? 'UTC';

    let didWork = false;
    for (const window of REMINDER_WINDOWS) {
      const eventsInWindow = candidateEvents.filter((event) => {
        if (!event[window.fieldKey]) return false;
        const msUntil = event.duration[0].getTime() - now.getTime();
        return msUntil >= -90_000 && msUntil <= window.ms;
      });
      if (eventsInWindow.length === 0) continue;
      didWork = true;
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
    if (!didWork) return false;
  }

  /** Fetch candidate events in the upcoming 24h window. */
  private async fetchCandidateEvents(now: Date) {
    const lowerBound = new Date(now.getTime() - 90_000);
    const upperBound = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return this.db
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
  }

  /** Fetch all user data needed for sending reminders. */
  private async fetchReminderContext(eventIds: number[]) {
    const signupsByEvent = await fetchSignupsByEvent(this.db, eventIds);
    const allUserIds = [...new Set(Array.from(signupsByEvent.values()).flat())];
    if (allUserIds.length === 0) return null;
    const [userMap, tzEntries, charsByUser] = await Promise.all([
      fetchUserMap(this.db, allUserIds),
      fetchUserTimezones(this.db, allUserIds),
      fetchCharactersByUser(this.db, allUserIds),
    ]);
    const tzMap = new Map(tzEntries.map((ut) => [ut.userId, ut.timezone]));
    return { signupsByEvent, userMap, tzMap, charsByUser };
  }

  /** Send reminders for all events in a specific window. */
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
    const ctx = await this.fetchReminderContext(events.map((e) => e.id));
    if (!ctx) return;
    for (const event of events) {
      await this.sendRemindersForEvent(
        event,
        ctx,
        windowType,
        windowLabel,
        now,
        defaultTimezone,
      );
    }
  }

  /** Compute event-level reminder context (timing, Discord URLs). */
  private async buildEventReminderContext(
    event: { id: number; duration: [Date, Date]; gameId: number | null },
    now: Date,
  ) {
    const startTime = event.duration[0];
    const minutesUntil = Math.max(
      0,
      Math.round((startTime.getTime() - now.getTime()) / 60000),
    );
    const [discordUrl, voiceChannelId] = await Promise.all([
      this.notificationService.getDiscordEmbedUrl(event.id),
      this.notificationService.resolveVoiceChannelForEvent(event.id),
    ]);
    return { startTime, minutesUntil, discordUrl, voiceChannelId };
  }

  /** Send reminders for a single event to all signed-up users. */
  private async sendRemindersForEvent(
    event: {
      id: number;
      title: string;
      duration: [Date, Date];
      gameId: number | null;
    },
    fetchCtx: ReminderFetchContext,
    windowType: ReminderWindowType,
    windowLabel: string,
    now: Date,
    defaultTimezone: string,
  ): Promise<void> {
    const userIds = fetchCtx.signupsByEvent.get(event.id) ?? [];
    const eventCtx = await this.buildEventReminderContext(event, now);
    for (const userId of userIds) {
      if (!fetchCtx.userMap.get(userId)) continue;
      await this.sendSingleUserReminder(
        event,
        userId,
        eventCtx,
        fetchCtx,
        windowType,
        windowLabel,
        defaultTimezone,
      );
    }
  }

  /** Send a reminder to a single user. */
  private async sendSingleUserReminder(
    event: { id: number; title: string; gameId?: number | null },
    userId: number,
    eventCtx: Awaited<
      ReturnType<EventReminderService['buildEventReminderContext']>
    >,
    fetchCtx: Pick<ReminderFetchContext, 'charsByUser' | 'tzMap'>,
    windowType: ReminderWindowType,
    windowLabel: string,
    defaultTimezone: string,
  ): Promise<void> {
    await this.sendReminder({
      eventId: event.id,
      userId,
      windowType,
      windowLabel,
      title: event.title,
      ...eventCtx,
      characterDisplay: buildCharDisplay(
        fetchCtx.charsByUser,
        userId,
        event.gameId ?? null,
      ),
      timezone: fetchCtx.tzMap.get(userId),
      defaultTimezone,
    });
  }

  /** Send a single reminder notification with duplicate prevention. */
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
    if (!(await this.insertReminderDedup(input))) return false;
    const { messageText, titleTimeLabel } = buildReminderStrings(input);
    await this.notificationService.create({
      userId: input.userId,
      type: 'event_reminder',
      title: `Event Starting ${titleTimeLabel}!`,
      message: messageText,
      payload: buildReminderPayload(input),
    });
    return true;
  }

  /** Insert dedup record — returns true if this is the first send. */
  private async insertReminderDedup(input: {
    eventId: number;
    userId: number;
    windowType: string;
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
    return result.length > 0;
  }

  /** Fetch user timezones (public for test access). */
  async getUserTimezones(
    userIds?: number[],
  ): Promise<{ userId: number; timezone: string }[]> {
    return fetchUserTimezones(this.db, userIds);
  }
}
