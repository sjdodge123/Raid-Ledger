/**
 * ROK-1767: a hard account delete cascades the bot's game-role grant rows
 * away. Without them the reconcile reads the roles as hand-assigned and never
 * removes them, so `UsersService.deleteUser`'s awaited `user.deleting` event
 * takes every bot-granted role back first. Best-effort: the helper logs and
 * reports a failure and never throws, so the delete always proceeds.
 * Decoupled by event so UsersModule does not inject the bot client.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { USER_DELETING_EVENT } from '../../calendar-sync/write/calendar-account-delete.listener';
import { revokeGameRoleGrants } from '../../users/users-moderation-game-roles.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import type { GameRoleDb } from './game-role-reconcile.helpers';

@Injectable()
export class GameRoleAccountDeleteListener {
  private readonly logger = new Logger(GameRoleAccountDeleteListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: GameRoleDb,
    private readonly botClient: DiscordBotClientService,
  ) {}

  @OnEvent(USER_DELETING_EVENT)
  async onUserDeleting(payload: { userId: number }): Promise<void> {
    const guild = this.botClient.getGuild();
    await revokeGameRoleGrants(
      this.db,
      guild,
      payload.userId,
      this.logger,
      'deleted',
    );
  }
}
