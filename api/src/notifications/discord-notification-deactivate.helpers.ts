import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { UsersService } from '../users/users.service';
import { NotificationService } from './notification.service';
import { SignupsRosterService } from '../events/signups-roster.service';
import { cancelAllUpcomingSignupsForUser } from '../events/signup-cancel-batch.helpers';
import { invalidateAuthUser } from '../auth/auth-user-cache';
import { RefreshTokenService } from '../auth/refresh/refresh-token.service';

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
  const deps = resolveDeactivationDeps(moduleRef);
  const { usersService, rosterService, notificationService } = deps;
  if (!usersService || !rosterService || !notificationService) {
    logger.warn(
      `ROK-1260: deactivateUser(${userId}) — deps not wired, skipping`,
    );
    return;
  }
  await deactivateUserOrchestrated(
    {
      db,
      logger,
      usersService,
      rosterService,
      notificationService,
      refreshTokenService: deps.refreshTokenService,
    },
    userId,
  );
}

/**
 * Resolve the cross-module deps lazily through ModuleRef (avoids the 3-way
 * Notification↔Users↔Events boot cycle). `refreshTokenService` is optional —
 * an older boot graph may not have AuthModule wired (ROK-1353).
 */
function resolveDeactivationDeps(moduleRef: ModuleRef): {
  usersService: UsersService | null;
  rosterService: SignupsRosterService | null;
  notificationService: NotificationService | null;
  refreshTokenService: RefreshTokenService | null;
} {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const u = require('../users/users.service') as {
    UsersService: new (...a: unknown[]) => UsersService;
  };
  const r = require('../events/signups-roster.service') as {
    SignupsRosterService: new (...a: unknown[]) => SignupsRosterService;
  };
  const n = require('./notification.service') as {
    NotificationService: new (...a: unknown[]) => NotificationService;
  };
  const rt = require('../auth/refresh/refresh-token.service') as {
    RefreshTokenService: new (...a: unknown[]) => RefreshTokenService;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const opt = { strict: false };
  return {
    usersService: moduleRef.get(u.UsersService, opt),
    rosterService: moduleRef.get(r.SignupsRosterService, opt),
    notificationService: moduleRef.get(n.NotificationService, opt),
    refreshTokenService: moduleRef.get(rt.RefreshTokenService, opt),
  };
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
    refreshTokenService?: RefreshTokenService | null;
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
  // ROK-1275: drop the cached auth-user row so any in-flight JWT validates
  // against the fresh deactivated_at value, not the 30-second-stale cache.
  invalidateAuthUser(row.id);
  // ROK-1353: revoke EVERY refresh family so a guild-leaver can't silently
  // re-mint a session — this is the primary deactivation path (guild leave).
  await revokeRefreshTokens(deps, row.id);
  deps.logger.log(
    `ROK-1260: deactivated user ${row.id} (${row.username}) — running cancel cascade`,
  );
  await runCascade(deps, row.id);
  await writeAdminNotification(deps, row);
}

/** ROK-1353: best-effort revoke of all refresh tokens for a deactivated user. */
async function revokeRefreshTokens(
  deps: {
    refreshTokenService?: RefreshTokenService | null;
    logger: Logger;
  },
  userId: number,
): Promise<void> {
  if (!deps.refreshTokenService) return;
  try {
    await deps.refreshTokenService.revokeAllForUser(userId);
  } catch (err: unknown) {
    deps.logger.warn(
      `ROK-1353: refresh-token revoke for user ${userId} failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
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
