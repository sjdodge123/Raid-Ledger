import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';

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
export interface RoleGap {
  role: string;
  required: number;
  filled: number;
  missing: number;
}

/** Aggregated gap result for one event. */
export interface RoleGapResult {
  eventId: number;
  creatorId: number;
  title: string;
  startTime: Date;
  gameId: number | null;
  gaps: RoleGap[];
}

/**
 * ROK-536 / ROK-683: Dedicated service for role gap alerts.
 *
 * Extracted from EventReminderService to keep each service focused.
 * Checks for MMO events ~4h out with unfilled tank/healer slots and
 * sends a one-time alert to the event creator.
 */
@Injectable()
export class RoleGapAlertService {
  private readonly logger = new Logger(RoleGapAlertService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Check for MMO events ~4h out with unfilled tank/healer slots.
   * Sends a one-time alert to the event creator.
   */
  async checkRoleGaps(now: Date, defaultTimezone: string): Promise<void> {
    const candidates = await this.fetchCandidateEvents(now);
    if (candidates.length === 0) return;

    const countMap = await this.fetchRoleCounts(candidates.map((e) => e.id));

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

  /** Fetch MMO events within the role gap window. */
  private async fetchCandidateEvents(now: Date) {
    const lowerBound = new Date(
      now.getTime() + ROLE_GAP_WINDOW.centerMs - ROLE_GAP_WINDOW.halfWidthMs,
    );
    const upperBound = new Date(
      now.getTime() + ROLE_GAP_WINDOW.centerMs + ROLE_GAP_WINDOW.halfWidthMs,
    );
    return this.db
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
  }

  /** Query critical role count rows from the DB. */
  private async queryRoleCounts(eventIds: number[]) {
    return this.db
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
  }

  /** Fetch critical role counts for the given event IDs. */
  private async fetchRoleCounts(
    eventIds: number[],
  ): Promise<Map<number, Map<string, number>>> {
    const roleCounts = await this.queryRoleCounts(eventIds);
    const countMap = new Map<number, Map<string, number>>();
    for (const row of roleCounts) {
      if (!countMap.has(row.eventId)) countMap.set(row.eventId, new Map());
      countMap.get(row.eventId)!.set(row.role!, Number(row.count));
    }
    return countMap;
  }

  /**
   * Compare filled roles against slot config requirements.
   * Returns gaps only for roles below the required count.
   */
  detectRoleGaps(
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

  /** Format a time string in the creator's timezone. */
  private async formatAlertTime(
    startTime: Date,
    creatorId: number,
    defaultTimezone: string,
  ): Promise<string> {
    const timezone = await this.resolveCreatorTimezone(
      creatorId,
      defaultTimezone,
    );
    return startTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
      timeZone: timezone,
    });
  }

  /** Send a role gap alert to the event creator. Deduplicates via event_reminders_sent. */
  async sendRoleGapAlert(
    result: RoleGapResult,
    defaultTimezone: string,
  ): Promise<boolean> {
    if (!(await this.insertAlertDedup(result))) return false;
    const { gapSummary, rosterSummary, suggestedReason } =
      this.buildGapSummaries(result.gaps);
    const timeStr = await this.formatAlertTime(
      result.startTime,
      result.creatorId,
      defaultTimezone,
    );
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

  /** Insert dedup record for role gap alert. Returns true if first time. */
  private async insertAlertDedup(result: RoleGapResult): Promise<boolean> {
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
    return dedup.length > 0;
  }

  /**
   * Build human-readable gap and roster summaries from role gaps.
   */
  private buildGapSummaries(gaps: RoleGap[]): {
    gapSummary: string;
    rosterSummary: string;
    suggestedReason: string;
  } {
    const gapParts = gaps.map(
      (g) => `${g.missing} ${g.role}${g.missing > 1 ? 's' : ''}`,
    );
    const gapSummary = `Missing ${gapParts.join(', ')}`;

    const rosterParts = gaps.map(
      (g) =>
        `${g.role.charAt(0).toUpperCase() + g.role.slice(1)}s: ${g.filled}/${g.required}`,
    );
    const rosterSummary = rosterParts.join(' | ');

    const roleList = gaps.map((g) => g.role).join('/');
    const suggestedReason = `Not enough ${roleList} — ${gapSummary.toLowerCase()}`;

    return { gapSummary, rosterSummary, suggestedReason };
  }

  /**
   * Resolve the creator's timezone preference, falling back to the default.
   */
  private async resolveCreatorTimezone(
    creatorId: number,
    defaultTimezone: string,
  ): Promise<string> {
    const conditions = [
      eq(schema.userPreferences.key, 'timezone'),
      eq(schema.userPreferences.userId, creatorId),
    ];

    const rows = await this.db
      .select({ value: schema.userPreferences.value })
      .from(schema.userPreferences)
      .where(and(...conditions));

    if (rows.length === 0) return defaultTimezone;
    const tz = rows[0].value as string;
    return tz && tz !== 'auto' ? tz : defaultTimezone;
  }
}
