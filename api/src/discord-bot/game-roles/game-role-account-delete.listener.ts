/**
 * ROK-1767: a hard account delete cascades the bot's game-role grant rows
 * away. Without them the reconcile reads the roles as hand-assigned and never
 * removes them, so `UsersService.deleteUser`'s awaited `user.deleting` event
 * takes every bot-granted role back first. Best-effort: the helper logs and
 * reports a failure and never throws, so the delete always proceeds.
 * Decoupled by event so UsersModule does not inject the bot client.
 *
 * Like the calendar cleanup on the same event, the revoke runs under ONE
 * total budget: each Discord call can wait out its own timeout, so a slow
 * guild could otherwise hold the delete request past nginx's 60s. At the
 * budget the remaining roles are abandoned (logged + reported) and the
 * delete proceeds.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { USER_DELETING_EVENT } from '../../calendar-sync/write/calendar-account-delete.listener';
import { revokeGameRoleGrants } from '../../users/users-moderation-game-roles.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import type { GameRoleDb } from './game-role-reconcile.helpers';

export const GAME_ROLE_DELETE_BUDGET_MS = 10_000;

@Injectable()
export class GameRoleAccountDeleteListener {
  private readonly logger = new Logger(GameRoleAccountDeleteListener.name);
  /** Mutable so a spec can shorten it; production keeps the default. */
  budgetMs = GAME_ROLE_DELETE_BUDGET_MS;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: GameRoleDb,
    private readonly botClient: DiscordBotClientService,
  ) {}

  @OnEvent(USER_DELETING_EVENT)
  async onUserDeleting(payload: { userId: number }): Promise<void> {
    const guild = this.botClient.getGuild();
    const work = revokeGameRoleGrants(
      this.db,
      guild,
      payload.userId,
      this.logger,
      'deleted',
    ).then(() => 'done' as const);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.budgetMs);
    });
    try {
      if ((await Promise.race([work, timeout])) === 'timeout') {
        this.reportTimeout(payload.userId);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private reportTimeout(userId: number): void {
    const msg = `ROK-1767: game-role revoke for deleted user ${userId} exceeded ${this.budgetMs}ms; remaining roles left in place`;
    this.logger.warn(msg);
    Sentry.captureException(new Error(msg), {
      tags: { userId: String(userId) },
    });
  }
}
