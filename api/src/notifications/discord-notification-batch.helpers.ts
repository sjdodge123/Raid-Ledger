/**
 * Batch helpers for DiscordNotificationService.dispatchMany (ROK-1043).
 * Extracted from discord-notification.service.ts to keep within file size limits.
 */
import { Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import * as schema from '../drizzle/schema';
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import {
  RATE_LIMIT_WINDOW_MS,
  isDiscordSnowflake,
  type DiscordNotificationJobData,
} from './discord-notification.constants';

export interface DispatchManyInput {
  notificationId: string;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

/** Load Discord IDs for a set of users in one query. */
async function loadDiscordIds(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: schema.users.id, discordId: schema.users.discordId })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  const out = new Map<number, string>();
  for (const row of rows) {
    if (row.discordId && isDiscordSnowflake(row.discordId))
      out.set(row.id, row.discordId);
  }
  return out;
}

/** Load set of notification types disabled on Discord per user, in one query. */
async function loadDisabledTypes(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Map<number, Set<NotificationType>>> {
  const rows = await db
    .select()
    .from(schema.userNotificationPreferences)
    .where(inArray(schema.userNotificationPreferences.userId, userIds));
  const out = new Map<number, Set<NotificationType>>();
  for (const row of rows) {
    const prefs = row.channelPrefs as Record<string, Record<string, boolean>>;
    const disabled = new Set<NotificationType>();
    for (const [type, channels] of Object.entries(prefs)) {
      if (channels && channels.discord === false)
        disabled.add(type as NotificationType);
    }
    out.set(row.userId, disabled);
  }
  return out;
}

function rateLimitKeyFor(input: DispatchManyInput): string {
  const subType =
    (input.payload?.reminderWindow as string | undefined) ??
    (input.payload?.subtype as string | undefined) ??
    '';
  return `discord-notif:rate:${input.userId}:${input.type}${subType ? `:${subType}` : ''}`;
}

async function filterRateLimited(
  redis: Redis,
  candidates: DispatchManyInput[],
): Promise<DispatchManyInput[]> {
  if (candidates.length === 0) return [];
  const keys = candidates.map(rateLimitKeyFor);
  const results = await redis.mget(...keys);
  const allowed: DispatchManyInput[] = [];
  const pipeline = redis.pipeline();
  for (let i = 0; i < candidates.length; i++) {
    const recent = results[i];
    if (recent && parseInt(recent, 10) > 0) continue;
    allowed.push(candidates[i]);
    pipeline.set(keys[i], '1', 'PX', RATE_LIMIT_WINDOW_MS);
  }
  if (allowed.length > 0) await pipeline.exec();
  return allowed;
}

function buildJobs(
  inputs: DispatchManyInput[],
  discordIds: Map<number, string>,
  disabledByUser: Map<number, Set<NotificationType>>,
): DispatchManyInput[] {
  const out: DispatchManyInput[] = [];
  for (const input of inputs) {
    const discordId = discordIds.get(input.userId);
    if (!discordId) continue;
    if (disabledByUser.get(input.userId)?.has(input.type)) continue;
    out.push(input);
  }
  return out;
}

function jobDataFor(
  input: DispatchManyInput,
  discordIds: Map<number, string>,
): DiscordNotificationJobData {
  return {
    notificationId: input.notificationId,
    userId: input.userId,
    discordId: discordIds.get(input.userId)!,
    type: input.type,
    title: input.title,
    message: input.message,
    payload: input.payload,
  };
}

async function loadRecipientData(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<{
  discordIds: Map<number, string>;
  disabledByUser: Map<number, Set<NotificationType>>;
}> {
  const [discordIds, disabledByUser] = await Promise.all([
    loadDiscordIds(db, userIds),
    loadDisabledTypes(db, userIds),
  ]);
  return { discordIds, disabledByUser };
}

async function enqueueBulkJobs(
  queue: Queue,
  allowed: DispatchManyInput[],
  discordIds: Map<number, string>,
): Promise<void> {
  await queue.addBulk(
    allowed.map((input) => ({
      name: 'send-dm',
      data: jobDataFor(input, discordIds),
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    })),
  );
}

/**
 * Batch-dispatch Discord notifications.
 * Uses one IN-query for Discord IDs + preferences, pipelined rate-limit
 * checks, and a single `queue.addBulk` call.
 */
export async function dispatchManyDiscordNotifications(
  db: PostgresJsDatabase<typeof schema>,
  queue: Queue,
  redis: Redis,
  logger: Logger,
  botConnected: boolean,
  inputs: DispatchManyInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  if (!botConnected) {
    logger.debug('Discord bot not connected, skipping batch dispatch');
    return 0;
  }
  const userIds = [...new Set(inputs.map((i) => i.userId))];
  const { discordIds, disabledByUser } = await loadRecipientData(db, userIds);
  const eligible = buildJobs(inputs, discordIds, disabledByUser);
  const allowed = await filterRateLimited(redis, eligible);
  if (allowed.length === 0) return 0;
  await enqueueBulkJobs(queue, allowed, discordIds);
  logger.log(
    `Enqueued ${allowed.length}/${inputs.length} Discord notifications (batch)`,
  );
  return allowed.length;
}
