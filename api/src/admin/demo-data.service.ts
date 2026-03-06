import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { inArray, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import type {
  DemoDataStatusDto,
  DemoDataResultDto,
  DemoDataCountsDto,
} from '@raid-ledger/contract';
import {
  DEMO_USERNAMES,
  DEMO_NOTIFICATION_TITLES,
} from './demo-data.constants';
import { installDemoDataInner } from './demo-data-install-steps';

const BATCH_SIZE = 500;

/** Return empty demo data counts. */
function emptyCounts(): DemoDataCountsDto {
  return {
    users: 0,
    events: 0,
    characters: 0,
    signups: 0,
    availability: 0,
    gameTimeSlots: 0,
    notifications: 0,
  };
}

/** Count rows in a table filtered by user IDs. */
function countByUserIds(
  db: PostgresJsDatabase<typeof schema>,

  tbl: any,

  col: any,
  ids: number[],
): Promise<number> {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(tbl)
    .where(inArray(col, ids))
    .then((r: { count: number }[]) => r[0]?.count ?? 0);
}

@Injectable()
export class DemoDataService {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
  ) {}

  /** Get current demo data status with entity counts. */
  async getStatus(): Promise<DemoDataStatusDto> {
    const demoMode = await this.settingsService.getDemoMode();
    const counts = await this.getCounts();
    return { demoMode, ...counts };
  }

  /** Insert rows in batches to avoid hitting parameter limits. */
  async batchInsert(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    rows: Record<string, unknown>[],
    onConflict?: 'doNothing',
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const q = this.db.insert(table).values(batch as never);
      if (onConflict === 'doNothing') {
        await q.onConflictDoNothing();
      } else {
        await q;
      }
    }
  }

  /** Insert rows in batches, returning all inserted rows. */
  async batchInsertReturning(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const inserted = await this.db
        .insert(table)
        .values(batch as never)
        .returning();
      results.push(...inserted);
    }
    return results;
  }

  /** Install all demo data. Aborts if demo data already exists. */
  async installDemoData(): Promise<DemoDataResultDto> {
    const existing = await this.getCounts();
    if (existing.users > 0) {
      return {
        success: false,
        message:
          'Demo data already exists. Delete it first before reinstalling.',
        counts: existing,
      };
    }
    this.logger.log('Installing demo data (~100 users)...');
    return this.runInstall();
  }

  /** Execute installation with error handling. */
  private async runInstall(): Promise<DemoDataResultDto> {
    try {
      const result = await installDemoDataInner(this);
      this.logger.log('Demo data installed');
      return {
        success: true,
        message: `Demo data installed: ${result.users} users, ${result.events} events, ${result.characters} characters`,
        counts: result,
      };
    } catch (error) {
      this.logger.error('Failed to install demo data:', error);
      try {
        await this.clearDemoData();
      } catch {
        /* best-effort */
      }
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to install demo data',
        counts: emptyCounts(),
      };
    }
  }

  /** Delete all demo data in FK-constraint-safe order. */
  async clearDemoData(): Promise<DemoDataResultDto> {
    this.logger.log('Clearing demo data...');
    try {
      const countsBefore = await this.getCounts();
      await this.deleteDemoRows();
      await this.settingsService.setDemoMode(false);
      this.logger.log('Demo data cleared');
      return {
        success: true,
        message: `Demo data deleted: ${countsBefore.users} users, ${countsBefore.events} events removed`,
        counts: countsBefore,
      };
    } catch (error) {
      this.logger.error('Failed to clear demo data:', error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to clear demo data',
        counts: emptyCounts(),
      };
    }
  }

  /** Delete demo rows in FK-safe order. */
  private async deleteDemoRows(): Promise<void> {
    const demoUsers = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.username, [...DEMO_USERNAMES] as string[]));
    const ids = demoUsers.map((u) => u.id);
    if (ids.length > 0) await this.deleteDemoUserData(ids);
    await this.db
      .delete(schema.notifications)
      .where(
        inArray(schema.notifications.title, [
          ...DEMO_NOTIFICATION_TITLES,
        ] as string[]),
      );
  }

  /** Delete data owned by demo user IDs. */
  private async deleteDemoUserData(ids: number[]): Promise<void> {
    const demoEvents = await this.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(inArray(schema.events.creatorId, ids));
    const eventIds = demoEvents.map((e) => e.id);
    if (eventIds.length > 0) {
      await this.db
        .update(schema.availability)
        .set({ sourceEventId: null })
        .where(inArray(schema.availability.sourceEventId, eventIds));
    }
    await this.db
      .delete(schema.availability)
      .where(inArray(schema.availability.userId, ids));
    await this.db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.userId, ids));
    await this.db
      .delete(schema.localCredentials)
      .where(inArray(schema.localCredentials.userId, ids));
    if (eventIds.length > 0) {
      await this.db
        .delete(schema.events)
        .where(inArray(schema.events.id, eventIds));
    }
    await this.db.delete(schema.users).where(inArray(schema.users.id, ids));
  }

  /** Count demo entities by querying for DEMO_USERNAMES. */
  async getCounts(): Promise<DemoDataCountsDto> {
    const demoUsers = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.username, [...DEMO_USERNAMES] as string[]));
    const ids = demoUsers.map((u) => u.id);
    if (ids.length === 0) return emptyCounts();
    return this.countEntities(ids);
  }

  /** Count entities for given user IDs. */
  private async countEntities(ids: number[]): Promise<DemoDataCountsDto> {
    const c = (tbl: unknown, col: unknown) =>
      countByUserIds(this.db, tbl, col, ids);
    const [ev, ch, si, av, gt, no] = await Promise.all([
      c(schema.events, schema.events.creatorId),
      c(schema.characters, schema.characters.userId),
      c(schema.eventSignups, schema.eventSignups.userId),
      c(schema.availability, schema.availability.userId),
      c(schema.gameTimeTemplates, schema.gameTimeTemplates.userId),
      c(schema.notifications, schema.notifications.userId),
    ]);
    return {
      users: ids.length,
      events: ev,
      characters: ch,
      signups: si,
      availability: av,
      gameTimeSlots: gt,
      notifications: no,
    };
  }

  /** Expose db for helper functions. */
  get database() {
    return this.db;
  }

  /** Expose settings for helper functions. */
  get settings() {
    return this.settingsService;
  }
}
