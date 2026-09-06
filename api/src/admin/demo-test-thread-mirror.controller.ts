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
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { insertMirroredMessages } from '../discord-bot/thread-mirror/thread-mirror.db-helpers';
import { parseDemoBody } from './demo-test.utils';
import {
  SeedThreadMirrorSchema,
  toGameId,
  toSeedRows,
  type SeedThreadMirrorBody,
} from './demo-test-thread-mirror.helpers';

/** Guild used when neither the body nor an existing group row names one. */
const FALLBACK_SEED_GUILD_ID = '100000000000000001';

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
    private readonly db: PostgresJsDatabase<typeof schema>,
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
   * Seed (or clear) a mirrored thread for an LFG group — DEMO_MODE only.
   *
   * @param body - `{ threadId, guildId?, surfaceKind, surfaceId, messages }`.
   * @returns The effective guild plus how many rows were written / removed.
   */
  @Post('thread-mirror')
  @HttpCode(HttpStatus.OK)
  async seedThreadMirror(
    @Body() body: unknown,
  ): Promise<SeedThreadMirrorResult> {
    await this.assertDemoMode();
    const dto = parseDemoBody(SeedThreadMirrorSchema, body);
    const guildId = await this.bindThread(dto, toGameId(dto.surfaceId));
    const base = { success: true as const, threadId: dto.threadId, guildId };

    if (dto.messages === null) {
      const cleared = await this.clearMirror(dto.threadId);
      return { ...base, mirrored: 0, cleared };
    }
    const values = toSeedRows(dto.messages, guildId);
    await insertMirroredMessages(this.db, dto.threadId, values);
    return { ...base, mirrored: values.length, cleared: 0 };
  }

  /** Write (a) — make the thread app-owned. Returns the effective guild id. */
  private async bindThread(
    dto: SeedThreadMirrorBody,
    gameId: number,
  ): Promise<string> {
    const existing = await this.findOpenGroupRow(gameId);
    const guildId = dto.guildId ?? existing?.guildId ?? FALLBACK_SEED_GUILD_ID;
    const binding = {
      guildId,
      channelId: dto.threadId,
      threadId: dto.threadId,
      postKind: 'forum',
    };

    if (existing) {
      await this.db
        .update(schema.lfgGroupMessages)
        .set(binding)
        .where(eq(schema.lfgGroupMessages.id, existing.id));
    } else {
      await this.db
        .insert(schema.lfgGroupMessages)
        .values({ ...binding, gameId, messageId: dto.threadId, state: 'open' });
    }
    return guildId;
  }

  /** The game's live group row, if it already has one. */
  private async findOpenGroupRow(
    gameId: number,
  ): Promise<{ id: string; guildId: string } | undefined> {
    const [row] = await this.db
      .select({
        id: schema.lfgGroupMessages.id,
        guildId: schema.lfgGroupMessages.guildId,
      })
      .from(schema.lfgGroupMessages)
      .where(
        and(
          eq(schema.lfgGroupMessages.gameId, gameId),
          eq(schema.lfgGroupMessages.state, 'open'),
        ),
      )
      .limit(1);
    return row;
  }

  /** Write (b), inverted — remove every mirrored row for the thread. */
  private async clearMirror(threadId: string): Promise<number> {
    const removed = await this.db
      .delete(schema.discordThreadMessages)
      .where(eq(schema.discordThreadMessages.threadId, threadId))
      .returning({ id: schema.discordThreadMessages.id });
    return removed.length;
  }
}
