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
import { AdminGuard } from '../auth/admin.guard';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import {
  getLfgBoardEnabled,
  setLfgBoardEnabled,
} from '../settings/settings-lfg-board.helpers';
import { preflightLfgBoard } from './lfg-board/lfg-board-preflight.helpers';
import {
  LFG_BOARD_EVENTS,
  type LfgBoardToggledPayload,
} from './lfg-board/lfg-board.constants';
import {
  LfgBoardSettingsSchema,
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

  /** Current state of the LFG forum-board master toggle (default off). */
  @Get('lfg-board')
  async getSettings(): Promise<LfgBoardSettingsResponse> {
    return { enabled: await getLfgBoardEnabled(this.settingsService) };
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
      this.eventEmitter.emit(LFG_BOARD_EVENTS.TOGGLED, {
        enabled,
      } satisfies LfgBoardToggledPayload);
      this.logger.log(`LFG board ${enabled ? 'enabled' : 'disabled'}`);
      return warning ? { enabled, warning } : { enabled };
    } catch (error) {
      handleValidationError(error);
    }
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
