/**
 * DemoTestGuildGameTextController (ROK-2137) —
 * `POST /admin/test/wow/seed-guild-game-text` `{ guildId, motd?, info?, reportedAt? }`.
 *
 * Writes a guild's in-game reported MOTD / Guild Information
 * (`guild_profiles.game_*` + `*_reported_at`) through the LedgerLink storage
 * helper and clears `*_acknowledged_at`, so an editor sees "Changed in game".
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type { Db } from '../plugins/wow-common/guilds/guild-ingame-text.queries';
import type { GameTextRow } from '../plugins/wow-common/guilds/guild-ingame-game-text.helpers';
import { parseDemoBody } from './demo-test.utils';
import {
  SeedGuildGameTextSchema,
  seedGuildGameText,
} from './demo-test-guild-game-text.helpers';

@Controller('admin/test/wow')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestGuildGameTextController {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Store one in-game report (per field) and re-raise its notice. */
  @Post('seed-guild-game-text')
  @HttpCode(HttpStatus.OK)
  async seedGameText(
    @Body() body: unknown,
  ): Promise<{ guildId: number; game: GameTextRow }> {
    const input = parseDemoBody(SeedGuildGameTextSchema, body);
    const game = await seedGuildGameText(this.db, input);
    return { guildId: input.guildId, game };
  }
}
