import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
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
 * ROK-536: 4-hour role gap alert window.
 * Fires when MMO events are ~4h out and missing critical roles.
 */
const ROLE_GAP_WINDOW = {
  type: 'role_gap_4h' as const,
  /** Center of the window: 4 hours in ms */
  centerMs: 4 * 60 * 60 * 1000,
  /** Half-width: 15 minutes in ms (total window: 3h45m to 4h15m) */
  halfWidthMs: 15 * 60 * 1000,
};

/** MMO roles that trigger a gap alert when understaffed. */
const MMO_CRITICAL_ROLES = ['tank', 'healer'] as const;

/** Shape of a single role gap for the alert payload. */
interface RoleGap {
  role: string;
  required: number;
  filled: number;
  missing: number;
}

/** Aggregated gap result for one event. */
interface RoleGapResult {
  eventId: number;
  creatorId: number;
  title: string;
  startTime: Date;
  gameId: number | null;
  gaps: RoleGap[];
}

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

        // ROK-658: Bound to events starting within [-90s, +24h] from now.
        // Covers all reminder windows (15m, 1h, 24h) plus 90s cron jitter buffer.
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

        // ROK-658: Hoist getDefaultTimezone() once per cron run
        const defaultTimezone =
          (await this.settingsService.getDefaultTimezone()) ?? 'UTC';

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
            defaultTimezone,
          );
        }

        // ROK-536: Check for role gaps on MMO events ~4h out
        await this.checkRoleGaps(now, defaultTimezone);
      },
    );
  }

  /**
   * ROK-536: Check for MMO events ~4h out with unfilled tank/healer slots.
   * Sends a one-time alert to the event creator.
   */
  async checkRoleGaps(now: Date, defaultTimezone: string): Promise<void> {
    const lowerBound = new Date(
      now.getTime() + ROLE_GAP_WINDOW.centerMs - ROLE_GAP_WINDOW.halfWidthMs,
    );
    const upperBound = new Date(
      now.getTime() + ROLE_GAP_WINDOW.centerMs + ROLE_GAP_WINDOW.halfWidthMs,
    );

    // Query MMO events in the 4h window
    const candidates = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        duration: schema.events.duration,
        creatorId: schema.events.creatorId,
        gameId: schema.events.gameId,
        slotConfig: schema.events.slotConfig,
      })
      .from(schema.events)
      .where(
        and(
          isNull(schema.events.cancelledAt),
          sql`${schema.events.slotConfig}->>'type' = 'mmo'`,
          sql`lower(${schema.events.duration}) >= ${lowerBound.toISOString()}::timestamptz`,
          sql`lower(${schema.events.duration}) <= ${upperBound.toISOString()}::timestamptz`,
        ),
      );

    if (candidates.length === 0) return;

    const eventIds = candidates.map((e) => e.id);

    // Batch query roster assignments for critical roles, joined with signed_up signups
    const roleCounts = await this.db
      .select({
        eventId: schema.rosterAssignments.eventId,
        role: schema.rosterAssignments.role,
        count: sql<number>`count(*)`,
      })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(
        and(
          inArray(schema.rosterAssignments.eventId, eventIds),
          eq(schema.eventSignups.status, 'signed_up'),
          inArray(
            schema.rosterAssignments.role,
            MMO_CRITICAL_ROLES as unknown as string[],
          ),
        ),
      )
      .groupBy(schema.rosterAssignments.eventId, schema.rosterAssignments.role);

    // Build a lookup: eventId -> role -> count
    const countMap = new Map<number, Map<string, number>>();
    for (const row of roleCounts) {
      if (!countMap.has(row.eventId)) countMap.set(row.eventId, new Map());
      countMap.get(row.eventId)!.set(row.role!, Number(row.count));
    }

    // Check each event for gaps and send alerts
    for (const event of candidates) {
      const gaps = this.detectRoleGaps(event, countMap.get(event.id));
      if (gaps.length === 0) continue;

      await this.sendRoleGapAlert(
        {
          eventId: event.id,
          creatorId: event.creatorId,
          title: event.title,
          startTime: event.duration[0],
          gameId: event.gameId,
          gaps,
        },
        defaultTimezone,
      );
    }
  }

  /**
   * ROK-536: Compare filled roles against slot config requirements.
   * Returns gaps only for roles below the required count.
   */
  private detectRoleGaps(
    event: { slotConfig: unknown },
    filledByRole: Map<string, number> | undefined,
  ): RoleGap[] {
    const config = (event.slotConfig ?? {}) as Record<string, unknown>;
    const gaps: RoleGap[] = [];

    for (const role of MMO_CRITICAL_ROLES) {
      const required = (config[role] as number) ?? (role === 'tank' ? 2 : 4);
      const filled = filledByRole?.get(role) ?? 0;
      if (filled < required) {
        gaps.push({ role, required, filled, missing: required - filled });
      }
    }

    return gaps;
  }

  /**
   * ROK-536: Send a role gap alert to the event creator.
   * Deduplicates via event_reminders_sent with reminderType 'role_gap_4h'.
   */
  async sendRoleGapAlert(
    result: RoleGapResult,
    defaultTimezone: string,
  ): Promise<boolean> {
    // Dedup: one alert per event per creator
    const dedup = await this.db
      .insert(schema.eventRemindersSent)
      .values({
        eventId: result.eventId,
        userId: result.creatorId,
        reminderType: ROLE_GAP_WINDOW.type,
      })
      .onConflictDoNothing({
        target: [
          schema.eventRemindersSent.eventId,
          schema.eventRemindersSent.userId,
          schema.eventRemindersSent.reminderType,
        ],
      })
      .returning();

    if (dedup.length === 0) return false;

    // Build gap and roster summaries
    const gapParts = result.gaps.map(
      (g) => `${g.missing} ${g.role}${g.missing > 1 ? 's' : ''}`,
    );
    const gapSummary = `Missing ${gapParts.join(', ')}`;

    const rosterParts = result.gaps.map(
      (g) =>
        `${g.role.charAt(0).toUpperCase() + g.role.slice(1)}s: ${g.filled}/${g.required}`,
    );
    const rosterSummary = rosterParts.join(' | ');

    const roleList = result.gaps.map((g) => g.role).join('/');
    const suggestedReason = `Not enough ${roleList} — ${gapSummary.toLowerCase()}`;

    // Resolve timezone for time display
    const creatorTz = await this.getUserTimezones([result.creatorId]);
    const timezone = creatorTz[0]?.timezone ?? defaultTimezone;

    const timeStr = result.startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
      timeZone: timezone,
    });

    await this.notificationService.create({
      userId: result.creatorId,
      type: 'role_gap_alert',
      title: 'Role Gap Alert',
      message: `Your event "${result.title}" starts in ~4 hours at ${timeStr} and still needs roles filled. ${gapSummary}.`,
      payload: {
        eventId: result.eventId,
        eventTitle: result.title,
        startTime: result.startTime.toISOString(),
        gapSummary,
        rosterSummary,
        suggestedReason,
      },
    });

    return true;
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
    // ROK-658: Filter by signed-up user IDs instead of scanning all preferences
    const userTimezones = await this.getUserTimezones(allUserIds);
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

      // ROK-658: Hoist per-event lookups outside the per-user loop
      const discordUrl = await this.notificationService.getDiscordEmbedUrl(
        event.id,
      );
      const voiceChannelId =
        await this.notificationService.resolveVoiceChannelId(event.gameId);

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
          defaultTimezone,
          discordUrl,
          voiceChannelId,
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
    /** ROK-658: Pre-resolved default timezone (hoisted to once per cron run). */
    defaultTimezone?: string;
    /** ROK-658: Pre-resolved Discord embed URL (hoisted to once per event). */
    discordUrl?: string | null;
    /** ROK-658: Pre-resolved voice channel ID (hoisted to once per event). */
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

    if (result.length === 0) {
      // Already sent — duplicate
      return false;
    }

    // Resolve timezone: per-user preference → pre-resolved default → fallback UTC
    const timezone = input.timezone ?? input.defaultTimezone ?? 'UTC';

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

    // ROK-658: Use pre-resolved per-event values (hoisted from per-user loop)
    const discordUrl = input.discordUrl ?? null;
    const voiceChannelId = input.voiceChannelId ?? null;

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
   * ROK-658: Filter by user IDs to avoid full table scan.
   */
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
