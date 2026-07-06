/**
 * Admin moderation service (ROK-313). Split out of `UsersService` (which is at
 * the 300-line STRICT limit) so the kick/ban/unban delegators + audit reads have
 * a focused home. Wiring matches §9.4: `ModuleRef` (lazy RefreshTokenService +
 * SignupsRosterService, no AuthModule back-edge) + direct `DiscordBotClientService`.
 * All heavy logic lives in the orchestration/helper modules; this service just
 * assembles deps and delegates.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  BanUserDto,
  KickUserDto,
  AdminActionsListResponseDto,
} from '@raid-ledger/contract';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { buildModerationDeps } from './users-moderation-deps.helpers';
import {
  runKick,
  runUnkick,
  runBan,
  runUnban,
  type ModerationResult,
} from './users-moderation-orchestration.helpers';
import {
  insertAdminAction,
  getAdminActionsForUser as getAdminActionsForUserQuery,
  type InsertAdminActionInput,
} from './users-admin-actions.helpers';

@Injectable()
export class UsersModerationService {
  private readonly logger = new Logger(UsersModerationService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private readonly moduleRef: ModuleRef,
    private readonly discordBotClientService: DiscordBotClientService,
  ) {}

  /** Assemble the moderation cascade deps (lazy ModuleRef resolution, §9.4). */
  private deps() {
    return buildModerationDeps(
      this.moduleRef,
      this.db,
      this.logger,
      this.discordBotClientService,
    );
  }

  /** Kick a user — soft removal, preserves data (ROK-313 AC2). */
  async kickUser(
    actorId: number,
    userId: number,
    dto: KickUserDto,
  ): Promise<ModerationResult> {
    return runKick(this.deps(), {
      userId,
      actorId,
      reason: dto.reason,
      kickFromDiscord: dto.kickFromDiscord,
    });
  }

  /** Clear a kick (ROK-313). */
  async unkickUser(actorId: number, userId: number): Promise<ModerationResult> {
    return runUnkick(this.deps(), userId, actorId);
  }

  /** Ban a user — permanent lockout + deactivate, optional data wipe (ROK-313). */
  async banUser(
    actorId: number,
    userId: number,
    dto: BanUserDto,
  ): Promise<ModerationResult> {
    return runBan(this.deps(), {
      userId,
      actorId,
      reason: dto.reason,
      wipeData: dto.wipeData,
      kickFromDiscord: dto.kickFromDiscord,
    });
  }

  /** Lift a ban (ROK-313). Reactivation into the Players list is separate. */
  async unbanUser(actorId: number, userId: number): Promise<ModerationResult> {
    return runUnban(this.deps(), userId, actorId);
  }

  /** Record an admin moderation action in the audit log (ROK-313). */
  async logAdminAction(input: InsertAdminActionInput): Promise<void> {
    await insertAdminAction(this.db, input);
  }

  /** Paginated moderation audit history for a target user (ROK-313 §3c). */
  async getAdminActionsForUser(
    userId: number,
    page: number,
    limit: number,
  ): Promise<AdminActionsListResponseDto> {
    return getAdminActionsForUserQuery(this.db, userId, page, limit);
  }
}
