import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  ActivityActionDto,
  ActivityEntityTypeDto,
  ActivityEntryDto,
  ActivityTimelineResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';

interface ActivityRow {
  id: number;
  action: string;
  actorId: number | null;
  actorName: string | null;
  metadata: unknown;
  createdAt: Date;
}

function mapRow(r: ActivityRow): ActivityEntryDto {
  return {
    id: r.id,
    action: r.action as ActivityActionDto,
    actor: r.actorId
      ? { id: r.actorId, displayName: r.actorName ?? 'Unknown' }
      : null,
    metadata: (r.metadata as Record<string, unknown>) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class ActivityLogService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Record an activity log entry. All callers should await this. */
  async log(
    entityType: ActivityEntityTypeDto,
    entityId: number,
    action: ActivityActionDto,
    actorId?: number | null,
    metadata?: Record<string, unknown> | null,
  ): Promise<void> {
    await this.db.insert(schema.activityLog).values({
      entityType,
      entityId,
      action,
      actorId: actorId ?? null,
      metadata: metadata ?? null,
    });
  }

  /** Get the full activity timeline for an entity. */
  async getTimeline(
    entityType: ActivityEntityTypeDto,
    entityId: number,
  ): Promise<ActivityTimelineResponseDto> {
    const rows = await this.db
      .select({
        id: schema.activityLog.id,
        action: schema.activityLog.action,
        actorId: schema.activityLog.actorId,
        actorName: schema.users.displayName,
        metadata: schema.activityLog.metadata,
        createdAt: schema.activityLog.createdAt,
      })
      .from(schema.activityLog)
      .leftJoin(schema.users, eq(schema.activityLog.actorId, schema.users.id))
      .where(
        and(
          eq(schema.activityLog.entityType, entityType),
          eq(schema.activityLog.entityId, entityId),
        ),
      )
      .orderBy(asc(schema.activityLog.createdAt));

    return { data: rows.map(mapRow) };
  }
}
