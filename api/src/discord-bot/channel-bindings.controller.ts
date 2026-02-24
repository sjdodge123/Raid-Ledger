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
  CreateChannelBindingSchema,
  UpdateChannelBindingSchema,
  type ChannelBindingDto,
  type ChannelBindingListDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

function handleValidationError(error: unknown): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const zodError = error as ZodError;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  throw error;
}

@Controller('admin/discord/bindings')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class ChannelBindingsController {
  private readonly logger = new Logger(ChannelBindingsController.name);

  constructor(
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly clientService: DiscordBotClientService,
  ) {}

  @Get()
  async listBindings(): Promise<ChannelBindingListDto> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) {
      return { data: [] };
    }

    const bindings = await this.channelBindingsService.getBindings(guildId);

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

      const { binding: result } = await this.channelBindingsService.bind(
        guildId,
        dto.channelId,
        dto.channelType,
        dto.bindingPurpose,
        dto.gameId ?? null,
        dto.config,
      );

      return {
        data: {
          id: result.id,
          guildId: result.guildId,
          channelId: result.channelId,
          channelType: result.channelType as 'text' | 'voice',
          bindingPurpose:
            result.bindingPurpose as ChannelBindingDto['bindingPurpose'],
          gameId: result.gameId,
          config: result.config,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      };
    } catch (error) {
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

      if (!result) {
        throw new NotFoundException('Binding not found');
      }

      return {
        data: {
          id: result.id,
          guildId: result.guildId,
          channelId: result.channelId,
          channelType: result.channelType as 'text' | 'voice',
          bindingPurpose:
            result.bindingPurpose as ChannelBindingDto['bindingPurpose'],
          gameId: result.gameId,
          config: result.config,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      };
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

    await this.channelBindingsService.unbind(
      binding.guildId,
      binding.channelId,
      binding.recurrenceGroupId,
    );
  }
}
