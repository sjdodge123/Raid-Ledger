/**
 * ROK-1446 D12 — the smoke seam for the channel-level presence embed.
 *
 * Bots are filtered from every room (`humanMembers`, ROK-1445) and the
 * companion bot IS a bot, so no voice join it can perform will ever put it on
 * this embed. This endpoint replaces the Discord read + detection step of
 * `resolveRoom` for ONE channel and nothing else — partition, linked-event
 * lookup, render, post/edit, persistence and close all still run for real,
 * which is what makes the smoke test an end-to-end exercise of the message
 * rather than a render unit test wearing a costume.
 *
 * DEMO_MODE only: this drives the bot's real posting path, so it must be
 * unreachable outside DEMO_MODE. The gate below is copied verbatim from
 * `demo-test-ephemeral-voice.controller.ts`.
 */
import {
  Controller,
  Post,
  Body,
  Inject,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { and, desc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { parseDemoBody } from '../admin/demo-test.utils';
import { ChannelPresenceEmbedService } from './services/channel-presence-embed.service';
import type { RoomSnapshot } from './services/channel-presence-room.helpers';
import {
  SetLobbyPresenceSchema,
  type LobbyPresenceResponse,
} from './demo-test-lobby-presence.schemas';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestLobbyPresenceController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly presence: ChannelPresenceEmbedService,
  ) {}

  /**
   * Install (or clear) a room override and flush it immediately.
   *
   * `members: []` is an empty room and drives the recap path; `members: null`
   * clears the override entirely. The response carries the ids of the room's
   * open presence row so a smoke test can poll that exact message instead of
   * guessing which channel the resolver chose.
   */
  @Post('lobby-presence')
  @HttpCode(HttpStatus.OK)
  async setLobbyPresence(
    @Body() body: unknown,
  ): Promise<LobbyPresenceResponse> {
    await this.assertDemoMode();
    const { voiceChannelId, members } = parseDemoBody(
      SetLobbyPresenceSchema,
      body,
    );
    // The annotation is the compile-time proof that the body mirrors the
    // override input type — if `RoomMemberSnapshot` gains a field, this breaks.
    const snapshot: RoomSnapshot | null = members === null ? null : { members };

    await this.presence.setRoomOverride(voiceChannelId, snapshot);
    await this.presence.flushNow();
    return this.readOpenRow(voiceChannelId);
  }

  /**
   * The open presence row for a room (D7: the DB is truth, memory is a cache).
   *
   * Returns nulls rather than throwing when no row exists — clearing an
   * override for a room that never opened one is a legitimate cleanup call.
   */
  private async readOpenRow(
    voiceChannelId: string,
  ): Promise<LobbyPresenceResponse> {
    const table = schema.discordChannelPresenceMessages;
    const rows = await this.db
      .select({
        textChannelId: table.textChannelId,
        messageId: table.messageId,
      })
      .from(table)
      .where(
        and(eq(table.voiceChannelId, voiceChannelId), eq(table.status, 'open')),
      )
      .orderBy(desc(table.openedAt))
      .limit(1);

    return {
      textChannelId: rows[0]?.textChannelId ?? null,
      messageId: rows[0]?.messageId ?? null,
    };
  }

  /** DEMO_MODE gate — both env flag and DB setting must be on. */
  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }
}
