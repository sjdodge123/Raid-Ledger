/**
 * Builds the `ModerationDeps` bundle for the kick/ban cascade (ROK-313 §9.4).
 *
 * `RefreshTokenService` (AuthModule) and `SignupsRosterService` (EventsModule)
 * are resolved LAZILY through `ModuleRef` rather than constructor-injected:
 * UsersModule must NOT import AuthModule (AuthModule already imports UsersModule —
 * a back-edge would create a boot-fragile mutual cycle). The `require()` for the
 * DI token mirrors the proven pattern in
 * `discord-notification-deactivate.helpers.ts`. Resolution returns `null` when a
 * service is absent (e.g. a stripped-down unit-test module) so the best-effort
 * cascade steps simply no-op.
 */
import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { RefreshTokenService } from '../auth/refresh/refresh-token.service';
import type { SignupsRosterService } from '../events/signups-roster.service';
import type {
  DiscordKicker,
  ModerationDeps,
} from './users-moderation-orchestration.helpers';

function resolveRefreshTokenService(
  moduleRef: ModuleRef,
): RefreshTokenService | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const m = require('../auth/refresh/refresh-token.service') as {
      RefreshTokenService: new (...a: unknown[]) => RefreshTokenService;
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
    return moduleRef.get(m.RefreshTokenService, { strict: false }) ?? null;
  } catch {
    return null;
  }
}

function resolveRosterService(
  moduleRef: ModuleRef,
): SignupsRosterService | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const m = require('../events/signups-roster.service') as {
      SignupsRosterService: new (...a: unknown[]) => SignupsRosterService;
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
    return moduleRef.get(m.SignupsRosterService, { strict: false }) ?? null;
  } catch {
    return null;
  }
}

export function buildModerationDeps(
  moduleRef: ModuleRef,
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  discord: DiscordKicker,
): ModerationDeps {
  return {
    db,
    logger,
    discord,
    refreshTokenService: resolveRefreshTokenService(moduleRef),
    rosterService: resolveRosterService(moduleRef),
  };
}
