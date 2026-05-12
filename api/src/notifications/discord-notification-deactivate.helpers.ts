import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { UsersService } from '../users/users.service';
import { NotificationService } from './notification.service';
import { SignupsRosterService } from '../events/signups-roster.service';
import { cancelAllUpcomingSignupsForUser } from '../events/signup-cancel-batch.helpers';

/**
 * ModuleRef-aware entry point — resolves cross-module deps lazily to
 * avoid a 3-way Notification↔Users↔Events circular DI graph at boot,
 * then delegates to `deactivateUserOrchestrated`. Called by the
 * notification service so the service itself stays under the 300-line
 * STRICT limit (ROK-1260 file-size enforcement, ESLint max-lines).
 */
export async function deactivateUserViaModuleRef(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  moduleRef: ModuleRef | undefined,
  userId: number,
): Promise<void> {
  if (!moduleRef) {
    logger.warn(`ROK-1260: deactivateUser(${userId}) — no moduleRef, skipping`);
    return;
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const usersModule = require('../users/users.service') as {
    UsersService: new (...args: unknown[]) => UsersService;
  };
  const rosterModule = require('../events/signups-roster.service') as {
    SignupsRosterService: new (...args: unknown[]) => SignupsRosterService;
  };
  const notifModule = require('./notification.service') as {
    NotificationService: new (...args: unknown[]) => NotificationService;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const usersService = moduleRef.get(usersModule.UsersService, {
    strict: false,
  });
  const rosterService = moduleRef.get(rosterModule.SignupsRosterService, {
    strict: false,
  });
  const notificationService = moduleRef.get(notifModule.NotificationService, {
    strict: false,
  });
  if (!usersService || !rosterService || !notificationService) {
    logger.warn(
      `ROK-1260: deactivateUser(${userId}) — deps not wired, skipping`,
    );
    return;
  }
  await deactivateUserOrchestrated(
    { db, usersService, notificationService, rosterService, logger },
    userId,
  );
}

/**
 * Orchestrates user deactivation after a Discord 50278 (ROK-1260).
 *
 * Order (per architect: sequential commits, NOT one big transaction):
 *   1. UPDATE users SET deactivated_at = now()
 *      WHERE id = $1 AND deactivated_at IS NULL  RETURNING id, username
 *      → idempotent. Zero rows means already deactivated; bail.
 *   2. Cancel every upcoming-event signup via the existing
 *      `SignupsRosterService.cancel()` pipeline (per-signup try/catch).
 *   3. Insert admin in-app notification.
 *
 * `cancelSignup`'s own idempotency makes a partial-failure retry safe
 * (the cascade is gated on active-status signups; cancelled ones become
 * no-ops).
 */
export async function deactivateUserOrchestrated(
  deps: {
    db: PostgresJsDatabase<typeof schema>;
    usersService: UsersService;
    notificationService: NotificationService;
    rosterService: SignupsRosterService;
    logger: Logger;
  },
  userId: number,
): Promise<void> {
  const [row] = await deps.db
    .update(schema.users)
    .set({ deactivatedAt: sql`NOW()` })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deactivatedAt)))
    .returning({ id: schema.users.id, username: schema.users.username });
  if (!row) {
    deps.logger.debug(
      `ROK-1260: deactivateUser(${userId}) — already deactivated, skipping cascade`,
    );
    return;
  }
  deps.logger.log(
    `ROK-1260: deactivated user ${row.id} (${row.username}) — running cancel cascade`,
  );
  await runCascade(deps, row.id);
  await writeAdminNotification(deps, row);
}

async function runCascade(
  deps: {
    db: PostgresJsDatabase<typeof schema>;
    rosterService: SignupsRosterService;
    logger: Logger;
  },
  userId: number,
): Promise<void> {
  try {
    const count = await cancelAllUpcomingSignupsForUser(
      deps.db,
      deps.rosterService,
      userId,
    );
    deps.logger.log(
      `ROK-1260: cancelled ${count} upcoming signup(s) for deactivated user ${userId}`,
    );
  } catch (err: unknown) {
    deps.logger.warn(
      `ROK-1260: cancel cascade for user ${userId} failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

async function writeAdminNotification(
  deps: {
    usersService: UsersService;
    notificationService: NotificationService;
    logger: Logger;
  },
  user: { id: number; username: string },
): Promise<void> {
  try {
    const admin = await deps.usersService.findAdmin();
    if (!admin) {
      deps.logger.warn(
        `ROK-1260: no admin user found — skipping deactivation notification for user ${user.id}`,
      );
      return;
    }
    await deps.notificationService.create({
      userId: admin.id,
      type: 'user_deactivated_discord',
      title: 'User deactivated',
      message: `${user.username} left the Discord guild and was deactivated.`,
      payload: { deactivatedUserId: user.id, username: user.username },
      skipDiscord: true,
    });
  } catch (err: unknown) {
    deps.logger.warn(
      `ROK-1260: admin deactivation notification failed for user ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}
