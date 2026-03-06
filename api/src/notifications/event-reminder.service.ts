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
  fetchSignupsByEvent, fetchUserMap, fetchCharactersByUser, fetchUserTimezones,
  buildCharDisplay, buildReminderMessage, buildTitleTimeLabel,
} from './event-reminder.helpers';

const REMINDER_WINDOWS = [
  { type: '15min', label: '15 Minutes', ms: 15 * 60 * 1000, fieldKey: 'reminder15min' as const },
  { type: '1hour', label: '1 Hour', ms: 60 * 60 * 1000, fieldKey: 'reminder1hour' as const },
  { type: '24hour', label: '24 Hours', ms: 24 * 60 * 60 * 1000, fieldKey: 'reminder24hour' as const },
] as const;

type ReminderWindowType = (typeof REMINDER_WINDOWS)[number]['type'];

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
    await this.cronJobService.executeWithTracking('EventReminderService_handleReminders', async () => {
      await this.processReminderWindows();
    });
  }

  /** Core reminder processing logic. */
  private async processReminderWindows(): Promise<void> {
    this.logger.debug('Running event reminder check...');
    const now = new Date();
    const candidateEvents = await this.fetchCandidateEvents(now);
    const defaultTimezone = (await this.settingsService.getDefaultTimezone()) ?? 'UTC';

    for (const window of REMINDER_WINDOWS) {
      const eventsInWindow = candidateEvents.filter((event) => {
        if (!event[window.fieldKey]) return false;
        const msUntil = event.duration[0].getTime() - now.getTime();
        return msUntil >= -90_000 && msUntil <= window.ms;
      });
      if (eventsInWindow.length === 0) continue;
      this.logger.debug(`${window.type}: ${eventsInWindow.length} events in window`);
      await this.sendRemindersForWindow(eventsInWindow, window.type, window.label, now, defaultTimezone);
    }
    await this.roleGapAlertService.checkRoleGaps(now, defaultTimezone);
  }

  /** Fetch candidate events in the upcoming 24h window. */
  private async fetchCandidateEvents(now: Date) {
    const lowerBound = new Date(now.getTime() - 90_000);
    const upperBound = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return this.db.select({
      id: schema.events.id, title: schema.events.title, duration: schema.events.duration,
      gameId: schema.events.gameId, reminder15min: schema.events.reminder15min,
      reminder1hour: schema.events.reminder1hour, reminder24hour: schema.events.reminder24hour,
      cancelledAt: schema.events.cancelledAt,
    }).from(schema.events).where(and(
      isNull(schema.events.cancelledAt),
      sql`lower(${schema.events.duration}) >= ${lowerBound.toISOString()}::timestamptz`,
      sql`lower(${schema.events.duration}) <= ${upperBound.toISOString()}::timestamptz`,
    ));
  }

  /** Send reminders for all events in a specific window. */
  private async sendRemindersForWindow(
    events: { id: number; title: string; duration: [Date, Date]; gameId: number | null }[],
    windowType: ReminderWindowType, windowLabel: string, now: Date, defaultTimezone: string,
  ): Promise<void> {
    const eventIds = events.map((e) => e.id);
    const signupsByEvent = await fetchSignupsByEvent(this.db, eventIds);
    const allUserIds = [...new Set(Array.from(signupsByEvent.values()).flat())];
    if (allUserIds.length === 0) return;

    const userMap = await fetchUserMap(this.db, allUserIds);
    const tzMap = new Map((await fetchUserTimezones(this.db, allUserIds)).map((ut) => [ut.userId, ut.timezone]));
    const charsByUser = await fetchCharactersByUser(this.db, allUserIds);

    for (const event of events) {
      await this.sendRemindersForEvent(event, signupsByEvent, userMap, tzMap, charsByUser, windowType, windowLabel, now, defaultTimezone);
    }
  }

  /** Send reminders for a single event to all signed-up users. */
  private async sendRemindersForEvent(
    event: { id: number; title: string; duration: [Date, Date]; gameId: number | null },
    signupsByEvent: Map<number, number[]>, userMap: Map<number, { id: number; discordId: string | null }>,
    tzMap: Map<number, string>, charsByUser: Map<number, { userId: number; name: string; charClass: string | null; gameId: number }[]>,
    windowType: ReminderWindowType, windowLabel: string, now: Date, defaultTimezone: string,
  ): Promise<void> {
    const userIds = signupsByEvent.get(event.id) ?? [];
    const startTime = event.duration[0];
    const minutesUntil = Math.max(0, Math.round((startTime.getTime() - now.getTime()) / 60000));
    const discordUrl = await this.notificationService.getDiscordEmbedUrl(event.id);
    const voiceChannelId = await this.notificationService.resolveVoiceChannelId(event.gameId);

    for (const userId of userIds) {
      if (!userMap.get(userId)) continue;
      await this.sendReminder({
        eventId: event.id, userId, windowType, windowLabel, title: event.title, startTime, minutesUntil,
        characterDisplay: buildCharDisplay(charsByUser, userId, event.gameId),
        timezone: tzMap.get(userId), defaultTimezone, discordUrl, voiceChannelId,
      });
    }
  }

  /** Send a single reminder notification with duplicate prevention. */
  async sendReminder(input: {
    eventId: number; userId: number; windowType: ReminderWindowType; windowLabel: string;
    title: string; startTime: Date; minutesUntil: number; characterDisplay: string | null;
    timezone?: string; defaultTimezone?: string; discordUrl?: string | null; voiceChannelId?: string | null; gameId?: number | null;
  }): Promise<boolean> {
    const result = await this.db.insert(schema.eventRemindersSent).values({ eventId: input.eventId, userId: input.userId, reminderType: input.windowType })
      .onConflictDoNothing({ target: [schema.eventRemindersSent.eventId, schema.eventRemindersSent.userId, schema.eventRemindersSent.reminderType] }).returning();
    if (result.length === 0) return false;

    const timezone = input.timezone ?? input.defaultTimezone ?? 'UTC';
    const timeStr = input.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short', timeZone: timezone });
    const messageText = buildReminderMessage(input.title, timeStr, input.minutesUntil);
    const titleTimeLabel = buildTitleTimeLabel(input.minutesUntil);

    await this.notificationService.create({
      userId: input.userId, type: 'event_reminder', title: `Event Starting ${titleTimeLabel}!`, message: messageText,
      payload: { eventId: input.eventId, reminderWindow: input.windowType, characterDisplay: input.characterDisplay,
        startTime: input.startTime.toISOString(), ...(input.discordUrl ? { discordUrl: input.discordUrl } : {}), ...(input.voiceChannelId ? { voiceChannelId: input.voiceChannelId } : {}) },
    });
    return true;
  }

  /** Fetch user timezones (public for test access). */
  async getUserTimezones(userIds?: number[]): Promise<{ userId: number; timezone: string }[]> {
    return fetchUserTimezones(this.db, userIds);
  }
}
