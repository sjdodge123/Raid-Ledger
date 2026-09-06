/**
 * DemoTestThreadMirrorController (ROK-1483 AC8).
 *
 * DEMO_MODE-only seam that fabricates a mirrored Discord thread without a
 * Discord thread. Playwright cannot create a forum post, so `GET
 * /discord/threads/:id/messages` would be untestable from the browser tier
 * without this.
 *
 * It makes TWO writes, and the second is the one that is easy to miss:
 *
 *  (a) an OPEN `lfg_group_messages` row with `post_kind = 'forum'` and
 *      `thread_id` — a thread is app-owned ONLY by virtue of that row
 *      (`LfgGroupSurfaceResolver`), so without it every read is a 403, and
 *      `LfgGroupDetail.threadId` stays null so the panel never mounts.
 *  (b) the mirror rows themselves, through the SAME `toMirrorRow` +
 *      `insertMirroredMessages` pair the live listener uses.
 *
 * `messages: null` HARD-deletes the thread's mirror rows (not a soft delete):
 * a soft delete is invisible to the read query but is still a `message_id`
 * conflict, so `insertMirroredMessages`' `onConflictDoNothing` would silently
 * skip a re-seed of the same id and the next phase would assert against an
 * empty panel it did not ask for.
 */
import {
  Body,
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
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { insertMirroredMessages } from '../discord-bot/thread-mirror/thread-mirror.db-helpers';
import { parseDemoBody } from './demo-test.utils';
import {
  SeedThreadMirrorSchema,
  toGameId,
  toSeedRows,
} from './demo-test-thread-mirror.helpers';
import {
  bindThread,
  clearMirror,
  unbindThread,
  type SeedDb,
} from './demo-test-thread-mirror.db';

/** What the seam answers with — `guildId` is what the thread URL will carry. */
export interface SeedThreadMirrorResult {
  success: true;
  threadId: string;
  guildId: string;
  mirrored: number;
  cleared: number;
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestThreadMirrorController {
  constructor(
    private readonly settingsService: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: SeedDb,
  ) {}

  /** Gate — throws if DEMO_MODE is off in EITHER the env or the setting. */
  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /**
   * Seed, clear or fully unbind a mirrored thread — DEMO_MODE only.
   *
   * @param body - `{ threadId, guildId?, surfaceKind, surfaceId, messages,
   *   unbind? }`.
   * @returns The effective guild plus how many rows were written / removed.
   */
  @Post('thread-mirror')
  @HttpCode(HttpStatus.OK)
  async seedThreadMirror(
    @Body() body: unknown,
  ): Promise<SeedThreadMirrorResult> {
    await this.assertDemoMode();
    const dto = parseDemoBody(SeedThreadMirrorSchema, body);
    const gameId = toGameId(dto.surfaceId);

    if (dto.unbind === true) {
      const cleared = await unbindThread(this.db, dto.threadId, gameId);
      return this.result(dto.threadId, '', 0, cleared);
    }

    const guildId = await bindThread(this.db, dto, gameId);
    if (dto.messages === null) {
      const cleared = await clearMirror(this.db, dto.threadId);
      return this.result(dto.threadId, guildId, 0, cleared);
    }

    const values = toSeedRows(dto.messages, guildId);
    await insertMirroredMessages(this.db, dto.threadId, values);
    return this.result(dto.threadId, guildId, values.length, 0);
  }

  /** Uniform answer — `guildId` is what the thread's deep link will carry. */
  private result(
    threadId: string,
    guildId: string,
    mirrored: number,
    cleared: number,
  ): SeedThreadMirrorResult {
    return { success: true, threadId, guildId, mirrored, cleared };
  }
}
