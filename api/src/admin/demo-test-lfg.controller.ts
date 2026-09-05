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
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { SettingsService } from '../settings/settings.service';
import { LFG_BOARD_EVENTS } from '../discord-bot/lfg-board/lfg-board.constants';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestLfgController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly eventEmitter: EventEmitter2,
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
}
