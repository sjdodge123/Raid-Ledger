/**
 * Batch helpers for NotificationService.createMany (ROK-1043).
 * Extracted from notification.service.ts to keep it within file size limits.
 */
import { Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_CHANNEL_PREFS,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';
import {
  mapNotificationToDto,
  mapPreferencesToDto,
} from './notification-mapping.helpers';
import type {
  CreateNotificationInput,
  NotificationDto,
  NotificationPreferencesDto,
} from './notification.types';
import type { DiscordNotificationService } from './discord-notification.service';

/**
 * Load preferences for a list of users, backfilling defaults for users
 * without a row via a single ON CONFLICT DO NOTHING insert.
 */
export async function loadPreferencesForUsers(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Map<number, NotificationPreferencesDto>> {
  const rows = await db
    .select()
    .from(schema.userNotificationPreferences)
    .where(inArray(schema.userNotificationPreferences.userId, userIds));
  const byUser = new Map<number, NotificationPreferencesDto>();
  for (const row of rows) byUser.set(row.userId, mapPreferencesToDto(row));

  const missing = userIds.filter((id) => !byUser.has(id));
  if (missing.length > 0) {
    await db
      .insert(schema.userNotificationPreferences)
      .values(missing.map((userId) => ({ userId })))
      .onConflictDoNothing();
    for (const userId of missing) {
      byUser.set(userId, {
        userId,
        channelPrefs: { ...DEFAULT_CHANNEL_PREFS },
      });
    }
  }
  return byUser;
}

function isCategoryEnabled(
  type: NotificationType,
  prefs: NotificationPreferencesDto,
): boolean {
  return prefs.channelPrefs[type]?.inApp ?? true;
}

/**
 * Create many notifications in a single batch (ROK-1043).
 * Filters by in-app preference, multi-row inserts, fires Discord batch.
 */
export async function createManyNotifications(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  discordService: DiscordNotificationService | null,
  inputs: CreateNotificationInput[],
): Promise<NotificationDto[]> {
  if (inputs.length === 0) return [];
  const userIds = [...new Set(inputs.map((i) => i.userId))];

  const prefsByUser = await loadPreferencesForUsers(db, userIds);
  const eligible = inputs.filter((input) =>
    isCategoryEnabled(input.type, prefsByUser.get(input.userId)!),
  );
  if (eligible.length === 0) return [];

  const created = await db
    .insert(schema.notifications)
    .values(
      eligible.map((input) => ({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        payload: input.payload ?? null,
        expiresAt: input.expiresAt ?? null,
      })),
    )
    .returning();

  logger.log(
    `Created ${created.length} notifications (batch, types=${[
      ...new Set(eligible.map((e) => e.type)),
    ].join(',')})`,
  );

  dispatchDiscordBatch(logger, discordService, eligible, created);
  return created.map(mapNotificationToDto);
}

function dispatchDiscordBatch(
  logger: Logger,
  discordService: DiscordNotificationService | null,
  inputs: CreateNotificationInput[],
  created: (typeof schema.notifications.$inferSelect)[],
): void {
  if (!discordService) return;
  const jobs = inputs
    .map((input, idx) => ({ input, notification: created[idx] }))
    .filter(({ input }) => !input.skipDiscord)
    .map(({ input, notification }) => ({
      notificationId: notification.id,
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      payload: input.payload,
    }));
  if (jobs.length === 0) return;
  discordService.dispatchMany(jobs).catch((err: unknown) => {
    logger.warn(
      `Failed to dispatch Discord batch: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  });
}
