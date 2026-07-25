import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { ChannelBindingsService } from './services/channel-bindings.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import {
  classifyBindingTriple,
  CreateChannelBindingSchema,
  UpdateChannelBindingSchema,
  type BindingPurpose,
  type ChannelBindingDto,
  type ChannelBindingListDto,
  type ChannelType,
} from '@raid-ledger/contract';
import { handleValidationError } from './validation.util';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema';
import { getLogLevels } from '../main.helpers';

interface BindingHealthDto {
  data: Array<{
    id: string;
    channelId: string;
    channelName?: string;
    code: string;
    message: string;
  }>;
  adHocEventsEnabled: boolean;
  logLevels: { effective: string[]; DEBUG?: string; LOG_LEVEL?: string };
}

@Controller('admin/discord/bindings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class ChannelBindingsController {
  private readonly logger = new Logger(ChannelBindingsController.name);

  constructor(
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * ROK-1415 Tier-4 health probe. Reports every binding whose (channelType,
   * bindingPurpose, gameId) triple the contract classifier rejects — above all
   * the inert (voice, game-voice-monitor, NULL) Quick Play shape — plus the
   * ad-hoc kill-switch state and the container's EFFECTIVE log levels, so one
   * restart-free request answers "why is Quick Play dead here" end to end.
   */
  @Get('health')
  async bindingHealth(): Promise<BindingHealthDto> {
    const guildId = this.clientService.getGuildId();
    const bindings = guildId
      ? await this.channelBindingsService.getBindings(guildId)
      : [];
    const channelMap = new Map(
      [
        ...this.clientService.getTextChannels(),
        ...this.clientService.getVoiceChannels(),
      ].map((ch) => [ch.id, ch.name]),
    );
    const data = bindings.flatMap((b) => {
      const v = classifyBindingTriple(
        b.channelType as ChannelType,
        b.bindingPurpose as BindingPurpose,
        b.gameId,
      );
      if (!v) return [];
      return [
        {
          id: b.id,
          channelId: b.channelId,
          channelName: channelMap.get(b.channelId),
          code: v.code,
          message: v.message,
        },
      ];
    });
    const adHocEventsEnabled =
      (await this.settingsService.get(SETTING_KEYS.AD_HOC_EVENTS_ENABLED)) ===
      'true';
    return {
      data,
      adHocEventsEnabled,
      logLevels: {
        effective: getLogLevels(process.env),
        DEBUG: process.env.DEBUG,
        LOG_LEVEL: process.env.LOG_LEVEL,
      },
    };
  }

  @Get()
  async listBindings(): Promise<ChannelBindingListDto> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      return { data: [] };
    }

    const bindings =
      await this.channelBindingsService.getBindingsWithGameNames(guildId);

    // Enrich with channel names from Discord
    const textChannels = this.clientService.getTextChannels();
    const voiceChannels = this.clientService.getVoiceChannels();
    const allChannels = [...textChannels, ...voiceChannels];
    const channelMap = new Map(allChannels.map((ch) => [ch.id, ch.name]));

    const data: ChannelBindingDto[] = bindings.map((b) => ({
      id: b.id,
      guildId: b.guildId,
      channelId: b.channelId,
      channelName: channelMap.get(b.channelId),
      channelType: b.channelType as 'text' | 'voice',
      bindingPurpose: b.bindingPurpose as ChannelBindingDto['bindingPurpose'],
      gameId: b.gameId,
      gameName: b.gameName ?? null,
      recurrenceGroupId: b.recurrenceGroupId,
      config: b.config,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }));

    return { data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createBinding(
    @Body() body: unknown,
  ): Promise<{ data: ChannelBindingDto }> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      throw new BadRequestException('Discord bot is not connected to a guild');
    }
    try {
      const dto = CreateChannelBindingSchema.parse(body);
      if (dto.gameId != null) {
        const exists = await this.channelBindingsService.gameExists(dto.gameId);
        if (!exists) throw new NotFoundException('Game not found');
      }
      const { binding: result } = await this.channelBindingsService.bind(
        guildId,
        dto.channelId,
        dto.channelType,
        dto.bindingPurpose,
        dto.gameId ?? null,
        dto.config,
      );
      return { data: toBindingDto(result) };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleValidationError(error);
    }
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updateBinding(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ChannelBindingDto }> {
    try {
      const dto = UpdateChannelBindingSchema.parse(body);
      const result = await this.channelBindingsService.updateConfig(
        id,
        dto.config ?? {},
        dto.bindingPurpose,
      );
      if (!result) throw new NotFoundException('Binding not found');
      return { data: toBindingDto(result) };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      handleValidationError(error);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBinding(@Param('id') id: string): Promise<void> {
    const binding = await this.channelBindingsService.getBindingById(id);
    if (!binding) {
      throw new NotFoundException('Binding not found');
    }

    // ROK-1419: delete exactly THIS binding, not every non-series binding on
    // the channel (the #Gamer Night blast-radius bug that unbind() caused).
    await this.channelBindingsService.unbindById(id);
  }
}

/** Map a binding DB record to the API DTO shape. */
function toBindingDto(result: {
  id: string;
  guildId: string;
  channelId: string;
  channelType: string;
  bindingPurpose: string;
  gameId: number | null;
  recurrenceGroupId: string | null;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ChannelBindingDto {
  return {
    id: result.id,
    guildId: result.guildId,
    channelId: result.channelId,
    channelType: result.channelType as 'text' | 'voice',
    bindingPurpose:
      result.bindingPurpose as ChannelBindingDto['bindingPurpose'],
    gameId: result.gameId,
    recurrenceGroupId: result.recurrenceGroupId,
    config: result.config as ChannelBindingDto['config'],
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
