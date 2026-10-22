/**
 * DemoTestQuickPlayServerController — DEMO_MODE-only seam that puts an
 * UNLINKED game-server player (a SteamID with no Raid Ledger account) into the
 * game's live Quick Play (ROK-1888 ruling 2 smoke).
 *
 * The companion bot cannot be on a Pelican game server, and CI has no Pelican
 * panel, so the smoke can never produce a server-presence row on its own. This
 * endpoint calls `AdHocServerPresenceService.playerJoined` — the same sink the
 * Pelican presence reader calls — so the attach, the participant upsert, the
 * grace cancel and the queued card edit all run for real. What it SKIPS is the
 * Pelican log parse above the sink.
 *
 * It only ever ATTACHES: a game with no live Quick Play is refused (409), so
 * the seam never spawns an event under the server path's `minPlayers` rule.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { AdHocEventService } from '../discord-bot/services/ad-hoc-event.service';
import { AdHocServerPresenceService } from '../discord-bot/services/ad-hoc-server-presence.service';
import {
  findLiveGameAdHocEvent,
  resolveSteamIdentity,
} from '../discord-bot/services/ad-hoc-server-presence.helpers';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';

/** A stand-in `pelican_servers.id`; the participant column has no FK. */
export const DEMO_PELICAN_SERVER_ID = 990_001;

/** `{ gameId, steamId, displayName }` — the game, a SteamID64, its name. */
const ServerJoinSchema = z.object({
  gameId: z.number().int().positive(),
  steamId: z.string().regex(/^\d{17}$/, 'steamId must be a SteamID64'),
  displayName: z.string().min(1).max(64),
  pelicanServerId: z.number().int().positive().optional(),
});

/** The live Quick Play the unlinked player was attached to. */
export interface QuickPlayServerJoinResult {
  eventId: number;
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestQuickPlayServerController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly adHocEventService: AdHocEventService,
    private readonly serverPresence: AdHocServerPresenceService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Attach an unlinked SteamID to the game's live Quick Play. */
  @Post('quick-play/server-join')
  @HttpCode(HttpStatus.OK)
  async serverJoin(@Body() body: unknown): Promise<QuickPlayServerJoinResult> {
    await this.assertDemoMode();
    const parsed = parseDemoBody(ServerJoinSchema, body);
    if (await resolveSteamIdentity(this.db, parsed.steamId)) {
      throw new BadRequestException(
        'steamId belongs to a Raid Ledger account; this seam seeds UNLINKED players only',
      );
    }
    if (!(await this.adHocEventService.isEnabled())) {
      throw new ConflictException('Ad-hoc events are disabled');
    }
    const live = await findLiveGameAdHocEvent(this.db, parsed.gameId);
    if (!live) {
      throw new ConflictException(
        `Game ${parsed.gameId} has no live Quick Play`,
      );
    }
    const source = {
      pelicanServerId: parsed.pelicanServerId ?? DEMO_PELICAN_SERVER_ID,
      gameId: parsed.gameId,
    };
    await this.serverPresence.playerJoined(source, {
      steamId: parsed.steamId,
      displayName: parsed.displayName,
    });
    return { eventId: live.id };
  }
}
