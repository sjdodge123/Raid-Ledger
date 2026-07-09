import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events, type GuildMember } from 'discord.js';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { UsersService } from '../../users/users.service';
import { NotificationService } from '../../notifications/notification.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';

/**
 * Re-activate users when they rejoin the Discord guild (ROK-1260).
 *
 * Pattern mirrors `pug-invite.listener.ts`: registers a discord.js
 * Events.GuildMemberAdd handler when the bot connects, and clears the
 * registration flag on disconnect so reconnect cycles re-register cleanly.
 *
 * Operator decision: reactivation triggers ONLY on guild rejoin —
 * OAuth login does NOT reactivate.
 */
@Injectable()
export class GuildMemberAddListener {
  private readonly logger = new Logger(GuildMemberAddListener.name);
  private registered = false;
  private boundHandler: ((member: GuildMember) => void) | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly usersService: UsersService,
    private readonly notificationService: NotificationService,
  ) {}

  /** When bot connects, register the guildMemberAdd handler. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    if (this.registered) return;
    this.boundHandler = (member: GuildMember): void => {
      this.handleGuildMemberAdd(member).catch((err: unknown) => {
        this.logger.error(
          `ROK-1260: handleGuildMemberAdd failed for ${member.user.username}:`,
          err,
        );
      });
    };
    client.on(Events.GuildMemberAdd, this.boundHandler);
    this.registered = true;
    this.logger.log('Registered guildMemberAdd reactivation listener');
  }

  /** When bot disconnects, remove the handler and reset so reconnect re-registers cleanly. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    const client = this.clientService.getClient();
    if (client && this.boundHandler) {
      client.off(Events.GuildMemberAdd, this.boundHandler);
    }
    this.registered = false;
    this.boundHandler = null;
  }

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    const discordId = member.user.id;
    // ROK-313: a BANNED user rejoining the guild must NOT be reactivated —
    // ban keeps deactivated_at set so they stay out of the Players list (auth is
    // separately blocked by banned_at). The `banned_at IS NULL` guard skips them.
    const [row] = await this.db
      .update(schema.users)
      .set({ deactivatedAt: null })
      .where(
        and(
          eq(schema.users.discordId, discordId),
          isNotNull(schema.users.deactivatedAt),
          isNull(schema.users.bannedAt),
        ),
      )
      .returning({ id: schema.users.id, username: schema.users.username });
    if (!row) return;
    this.logger.log(
      `ROK-1260: reactivated user ${row.id} (${row.username}) on guild rejoin`,
    );
    await this.writeAdminNotification(row);
  }

  private async writeAdminNotification(user: {
    id: number;
    username: string;
  }): Promise<void> {
    try {
      const admin = await this.usersService.findAdmin();
      if (!admin) return;
      await this.notificationService.create({
        userId: admin.id,
        type: 'user_reactivated_discord',
        title: 'User reactivated',
        message: `${user.username} rejoined the Discord guild and was reactivated.`,
        payload: { reactivatedUserId: user.id, username: user.username },
        skipDiscord: true,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `ROK-1260: admin reactivation notification failed for user ${user.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }
}
