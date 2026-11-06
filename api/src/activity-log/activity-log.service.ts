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
import { displayNameSql } from '../users/display-name.helpers';

interface ActivityRow {
  id: number;
  action: string;
  actorId: number | null;
  actorName: string | null;
  metadata: unknown;
  createdAt: Date;
}

/**
 * Any metadata key naming a raw Discord identifier (`discordUserId`,
 * `discordId`, `discordUsername`, ...). ROK-1824: the reschedule-ack writer
 * stores `discordUserId` for participants with no Ledger account; the read
 * path must never return it, to any caller.
 */
const DISCORD_IDENTIFIER_KEY = /discord/i;

/**
 * Nesting levels below the top-level blob that are still walked. A deeper
 * subtree is dropped whole, so a pathological blob cannot blow the stack.
 */
const MAX_STRIP_DEPTH = 10;

/** Marker for a value removed because it sits past `MAX_STRIP_DEPTH`. */
const DROPPED: unique symbol = Symbol('dropped');

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripValue(value: unknown, depth: number): unknown {
  if (!Array.isArray(value) && !isRecord(value)) return value;
  if (depth > MAX_STRIP_DEPTH) return DROPPED;
  if (Array.isArray(value)) {
    return value
      .map((item: unknown) => stripValue(item, depth + 1))
      .filter((item: unknown) => item !== DROPPED);
  }
  return stripRecord(value, depth);
}

function stripRecord(
  record: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (DISCORD_IDENTIFIER_KEY.test(key)) continue;
    const stripped = stripValue(child, depth + 1);
    if (stripped !== DROPPED) kept[key] = stripped;
  }
  return kept;
}

/**
 * Drop raw Discord identifiers from a stored metadata blob (ROK-1824), at
 * every depth: nested objects and objects inside arrays are walked too.
 * Non-object (or array) input yields null.
 */
export function stripDiscordIdentifiers(
  metadata: unknown,
): Record<string, unknown> | null {
  if (!isRecord(metadata)) return null;
  return stripRecord(metadata, 0);
}

function mapRow(r: ActivityRow): ActivityEntryDto {
  return {
    id: r.id,
    action: r.action as ActivityActionDto,
    actor: r.actorId
      ? // 'Unknown' fallback fires only for orphan rows whose actorId points at a user the LEFT JOIN couldn't resolve (residue from before the activity_log.actor_id FK was enforced).
        { id: r.actorId, displayName: r.actorName ?? 'Unknown' }
      : null,
    metadata: stripDiscordIdentifiers(r.metadata),
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * What `log` inserts through: the service's own pool by default, or a caller's
 * transaction so the audit row commits (or rolls back) with its change.
 */
export type ActivityLogExecutor = Pick<
  PostgresJsDatabase<typeof schema>,
  'insert'
>;

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
    executor: ActivityLogExecutor = this.db,
  ): Promise<void> {
    await executor.insert(schema.activityLog).values({
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
        actorName: displayNameSql(schema.users),
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
