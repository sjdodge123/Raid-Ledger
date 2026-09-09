/**
 * DemoTestLfgController (ROK-1471 D10).
 *
 * DEMO_MODE-only endpoint used by the LFG board smoke test
 * (`tools/test-bot/src/smoke/tests/lfg-board.test.ts`).
 *
 * Thread renames and forum-tag edits are coalesced on a trailing 5s window
 * because Discord rate-limits renames aggressively. A smoke test asserting a
 * thread's name would otherwise have to sleep out that window, which the
 * project's smoke standard forbids — so it drains the window instead.
 *
 * The flush is delivered as an EVENT rather than an injected service on
 * purpose: `AdminModule` and `DiscordBotModule` already need a `forwardRef`,
 * and a module edge from here to `LfgBoardModule` would add a second cycle.
 * `emitAsync` (not `emit`) is what makes the HTTP response wait for the writes.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { AuthGuard } from '@nestjs/passport';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { LFG_BOARD_EVENTS } from '../discord-bot/lfg-board/lfg-board.constants';
import { LfgInviteService } from '../lfg/lfg-invite.service';

/** `{ userId, gameId }` — both positive integers, or 400. */
function parseInviteDeclineBody(body: unknown): {
  userId: number;
  gameId: number;
} {
  const raw = (body ?? {}) as Record<string, unknown>;
  const userId = Number(raw.userId);
  const gameId = Number(raw.gameId);
  const ok = (n: number) => Number.isInteger(n) && n > 0;
  if (!ok(userId) || !ok(gameId)) {
    throw new BadRequestException('userId and gameId must be positive ints');
  }
  return { userId, gameId };
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestLfgController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly lfgInviteService: LfgInviteService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settingsService.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Drain the LFG board's rename/tag debounce now — DEMO_MODE only. */
  @Post('lfg-board/flush')
  @HttpCode(HttpStatus.OK)
  async flushBoardEdits(): Promise<{ success: boolean }> {
    await this.assertDemoMode();
    await this.eventEmitter.emitAsync(LFG_BOARD_EVENTS.FLUSH);
    return { success: true };
  }

  /**
   * ROK-1455 D15 — press the DM's decline button on a user's behalf.
   *
   * Companion bots cannot click another bot's buttons, so the smoke proves the
   * decline EFFECT through here; the listener itself is covered by its own
   * spec. Same write path as the button: `LfgInviteService.decline`.
   */
  @Post('lfg-invite-decline')
  @HttpCode(HttpStatus.OK)
  async declineLfgInvite(
    @Body() body: unknown,
  ): Promise<{ declined: boolean }> {
    await this.assertDemoMode();
    const { userId, gameId } = parseInviteDeclineBody(body);
    return { declined: await this.lfgInviteService.decline(userId, gameId) };
  }

  /**
   * ROK-1455 — forget every invite a recipient ever received, so a smoke can
   * re-run against a persistent DB without tripping the no-repeat horizon.
   */
  @Post('lfg-invites/reset')
  @HttpCode(HttpStatus.OK)
  async resetLfgInvites(@Body() body: unknown): Promise<{ deleted: number }> {
    await this.assertDemoMode();
    const raw = (body ?? {}) as Record<string, unknown>;
    const userId = Number(raw.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException('userId must be a positive int');
    }
    const deleted = await this.db
      .delete(schema.lfgInvites)
      .where(eq(schema.lfgInvites.recipientUserId, userId))
      .returning({ id: schema.lfgInvites.id });
    return { deleted: deleted.length };
  }
}
