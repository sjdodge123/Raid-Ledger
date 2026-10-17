import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from './discord-bot-client.service';

interface DiscordMemberResponse {
  discordId: string;
  username: string;
  avatar: string | null;
  /** Whether this Discord user has a linked Raid Ledger account */
  isRegistered: boolean;
}

/**
 * Public-facing (any authenticated user) Discord member endpoints.
 * Used by the Invite modal for any signed-up user (ROK-292).
 * Separate from the admin-only DiscordBotSettingsController.
 */
@Controller('discord/members')
@UseGuards(AuthGuard('jwt'))
export class DiscordMemberController {
  constructor(
    private readonly discordBotClientService: DiscordBotClientService,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Cross-reference Discord member IDs with registered users.
   * Returns a Set of Discord IDs that have linked Raid Ledger accounts.
   */
  private async getRegisteredDiscordIds(
    discordIds: string[],
  ): Promise<Set<string>> {
    if (discordIds.length === 0) return new Set();
    const rows = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(inArray(schema.users.discordId, discordIds));
    return new Set(rows.map((r) => r.discordId).filter(Boolean) as string[]);
  }

  /**
   * List Discord server members (initial load for Invite modal).
   */
  @Get('list')
  async listMembers(): Promise<DiscordMemberResponse[]> {
    if (!this.discordBotClientService.isConnected()) {
      return [];
    }
    const members = await this.discordBotClientService.listGuildMembers(25);
    const registeredIds = await this.getRegisteredDiscordIds(
      members.map((m) => m.discordId),
    );
    return members.map((m) => ({
      ...m,
      isRegistered: registeredIds.has(m.discordId),
    }));
  }

  /**
   * Search Discord server members by username query.
   */
  @Get('search')
  async searchMembers(
    @Query('q') query: string,
  ): Promise<DiscordMemberResponse[]> {
    if (!query || query.trim().length < 1) {
      return [];
    }
    if (!this.discordBotClientService.isConnected()) {
      return [];
    }
    const members = await this.discordBotClientService.searchGuildMembers(
      query.trim(),
    );
    const registeredIds = await this.getRegisteredDiscordIds(
      members.map((m) => m.discordId),
    );
    return members.map((m) => ({
      ...m,
      isRegistered: registeredIds.has(m.discordId),
    }));
  }
}
