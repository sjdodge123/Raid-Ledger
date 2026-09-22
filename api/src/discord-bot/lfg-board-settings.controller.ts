import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { AdminGuard } from '../auth/admin.guard';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import {
  getLfgBoardChannelId,
  getLfgBoardEnabled,
  getLfgNowIndicatorEmoji,
  setLfgBoardEnabled,
  setLfgNowIndicatorEmoji,
} from '../settings/settings-lfg-board.helpers';
import { preflightLfgBoard } from './lfg-board/lfg-board-preflight.helpers';
import {
  LFG_BOARD_EVENTS,
  type LfgBoardToggledPayload,
} from './lfg-board/lfg-board.constants';
import {
  LfgBoardSettingsSchema,
  LfgNowIndicatorEmojiSchema,
  type LfgBoardSettingsResponse,
} from '@raid-ledger/contract';
import { handleValidationError } from './validation.util';

/**
 * ROK-1471 (D1/D5): the LFG forum-board master toggle.
 *
 * Its own controller so `discord-bot-settings.controller.ts` stays under the
 * 300-line cap.
 */
@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class LfgBoardSettingsController {
  private readonly logger = new Logger(LfgBoardSettingsController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly clientService: DiscordBotClientService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Current state of the LFG forum-board master toggle (default off), plus the
   * id of the forum channel the board listener created.
   *
   * `channelId` is null until that listener finishes — it runs asynchronously
   * off the toggle event, so an enable answers before the channel exists.
   * Exposing it is what lets a caller (the admin UI, the Discord smoke) find
   * the board deterministically instead of scanning the guild for a channel
   * named `lfg`, which a guild may legitimately have several of.
   */
  @Get('lfg-board')
  async getSettings(): Promise<LfgBoardSettingsResponse> {
    const [enabled, channelId, nowIndicatorEmoji] = await Promise.all([
      getLfgBoardEnabled(this.settingsService),
      getLfgBoardChannelId(this.settingsService),
      getLfgNowIndicatorEmoji(this.settingsService),
    ]);
    return { enabled, channelId, nowIndicatorEmoji };
  }

  /**
   * ROK-1619 — set the emoji that marks the press forming the group. Stored
   * raw; every surface resolves it through `resolveNowIndicatorEmoji`, which
   * degrades an unusable one to 🎉. A blank value clears it back to 🎉.
   *
   * @param body - `{ emoji: string }`, validated by the contract schema.
   * @returns The stored value, or null when cleared.
   */
  @Put('lfg-board/indicator-emoji')
  @HttpCode(HttpStatus.OK)
  async setIndicatorEmoji(
    @Body() body: unknown,
  ): Promise<{ nowIndicatorEmoji: string | null }> {
    try {
      const { emoji } = LfgNowIndicatorEmojiSchema.parse(body);
      await setLfgNowIndicatorEmoji(this.settingsService, emoji);
      return { nowIndicatorEmoji: emoji || null };
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Flip the master toggle.
   *
   * The permission preflight is ADVISORY: the toggle is persisted either way
   * and any missing permissions come back as `warning`. Rejecting with a 4xx
   * would strand an operator who is enabling the board precisely so they can
   * then fix the bot's install.
   *
   * @param body - `{ enabled: boolean }`, validated by the contract schema.
   * @returns The persisted state, plus an advisory warning when permissions are missing.
   */
  @Put('lfg-board')
  @HttpCode(HttpStatus.OK)
  async setSettings(@Body() body: unknown): Promise<LfgBoardSettingsResponse> {
    try {
      const { enabled } = LfgBoardSettingsSchema.parse(body);
      const warning = enabled ? this.preflight() : undefined;
      await setLfgBoardEnabled(this.settingsService, enabled);
      this.runToggleHandlers(enabled);
      this.logger.log(`LFG board ${enabled ? 'enabled' : 'disabled'}`);
      return warning ? { enabled, warning } : { enabled };
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * ROK-1523 — hand the Discord side to `LfgBoardToggleListener` in the
   * BACKGROUND. A disable retires every live post one at a time against
   * Discord's rate-limited thread bucket, and on a busy board that outlasts
   * nginx's 60s: the operator saw a 504 for a setting that had in fact saved.
   * The PUT answers for the save; the board catches up behind it (callers that
   * need the result poll Discord — the companion smoke already does).
   *
   * The listener is guarded and resolves on every path, but this still
   * catches: a rejection escaping here is an unhandled rejection, which is
   * fatal under Node 22, and nobody is awaiting it to see the error.
   *
   * @param enabled - The toggle's new, already persisted, state.
   */
  private runToggleHandlers(enabled: boolean): void {
    this.eventEmitter
      .emitAsync(LFG_BOARD_EVENTS.TOGGLED, {
        enabled,
      } satisfies LfgBoardToggledPayload)
      .catch((err: unknown) => {
        this.logger.error(
          `The LFG board toggle handlers failed in the background: ${
            err instanceof Error ? err.message : String(err)
          }. The setting is saved; re-flip the toggle to retry.`,
        );
        Sentry.captureException(err, { tags: { context: 'lfg-board-toggle' } });
      });
  }

  /** Missing board permissions, or undefined when clean / bot not connected. */
  private preflight(): { missing: string[] } | undefined {
    if (!this.clientService.isConnected()) return undefined;
    const guild = this.clientService.getGuild();
    if (!guild) return undefined;
    const { ok, missing } = preflightLfgBoard(guild);
    return ok ? undefined : { missing };
  }
}
