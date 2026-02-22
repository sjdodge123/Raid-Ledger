import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  Inject,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SetupWizardService } from './services/setup-wizard.service';
import { SettingsService } from '../settings/settings.service';
import { CharactersService } from '../characters/characters.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  DiscordBotConfigSchema,
  DiscordBotTestConnectionSchema,
  type DiscordBotStatusResponse,
  type DiscordBotTestResult,
  type CharacterDto,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

/**
 * Handle Zod validation errors by converting to BadRequestException.
 */
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

@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DiscordBotSettingsController {
  private readonly logger = new Logger(DiscordBotSettingsController.name);

  constructor(
    private readonly discordBotService: DiscordBotService,
    private readonly discordBotClientService: DiscordBotClientService,
    private readonly setupWizardService: SetupWizardService,
    private readonly settingsService: SettingsService,
    private readonly charactersService: CharactersService,
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Get()
  async getStatus(): Promise<DiscordBotStatusResponse> {
    return this.discordBotService.getStatus();
  }

  @Get('permissions')
  checkPermissions(): {
    allGranted: boolean;
    permissions: { name: string; granted: boolean }[];
  } {
    return this.discordBotService.checkPermissions();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateConfig(
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const config = DiscordBotConfigSchema.parse(body);

      await this.settingsService.setDiscordBotConfig(
        config.botToken,
        config.enabled,
      );

      this.logger.log('Discord bot configuration updated via admin UI');

      // Directly trigger connection as a reliable fallback.
      // The event-based path (DISCORD_BOT_UPDATED) also fires, but
      // ensureConnected is a no-op if a connection is already in progress.
      this.discordBotService
        .ensureConnected({ token: config.botToken, enabled: config.enabled })
        .catch((err: unknown) => {
          this.logger.error(
            'Background bot connection failed:',
            err instanceof Error ? err.message : err,
          );
        });

      return {
        success: true,
        message: 'Configuration saved.',
      };
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Body() body: unknown): Promise<DiscordBotTestResult> {
    try {
      const dto = DiscordBotTestConnectionSchema.parse(body);

      // Use provided token or fall back to stored one
      let token = dto.botToken;

      if (!token) {
        const config = await this.settingsService.getDiscordBotConfig();
        if (!config) {
          return {
            success: false,
            message: 'No bot token configured',
          };
        }
        token = config.token;
      }

      return this.discordBotService.testToken(token);
    } catch (error) {
      handleValidationError(error);
    }
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  async clearConfig(): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.settingsService.clearDiscordBotConfig();

    this.logger.log('Discord bot configuration cleared via admin UI');

    return {
      success: true,
      message: 'Discord bot configuration cleared.',
    };
  }

  @Get('channels')
  getChannels(): { id: string; name: string }[] {
    return this.discordBotClientService.getTextChannels();
  }

  @Get('channel')
  async getDefaultChannel(): Promise<{ channelId: string | null }> {
    const channelId = await this.settingsService.getDiscordBotDefaultChannel();
    return { channelId };
  }

  @Put('channel')
  @HttpCode(HttpStatus.OK)
  async setDefaultChannel(
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string }> {
    if (
      !body ||
      typeof body !== 'object' ||
      !('channelId' in body) ||
      typeof (body as Record<string, unknown>).channelId !== 'string' ||
      !(body as Record<string, unknown>).channelId
    ) {
      throw new BadRequestException(
        'channelId is required and must be a non-empty string',
      );
    }

    await this.settingsService.setDiscordBotDefaultChannel(
      (body as Record<string, unknown>).channelId as string,
    );

    this.logger.log('Discord bot default channel updated via admin UI');

    return {
      success: true,
      message: 'Default channel updated.',
    };
  }

  @Post('resend-setup')
  @HttpCode(HttpStatus.OK)
  async resendSetupWizard(): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.discordBotClientService.isConnected()) {
      throw new BadRequestException(
        'Discord bot must be connected to send the setup wizard',
      );
    }

    const result = await this.setupWizardService.sendSetupWizardToAdmin();

    if (!result.sent) {
      throw new BadRequestException(
        result.reason ?? 'Failed to send setup wizard DM',
      );
    }

    this.logger.log('Setup wizard DM re-sent via admin UI');

    return {
      success: true,
      message: 'Setup wizard DM sent to admin.',
    };
  }

  /**
   * ROK-292: Look up characters for a Discord user by their Discord ID and game.
   * Used by the Invite modal to show character options (like the Discord signup flow).
   */
  @Get('members/characters')
  async getMemberCharacters(
    @Query('discordId') discordId: string,
    @Query('gameId') gameId: string,
  ): Promise<CharacterDto[]> {
    if (!discordId || !gameId) {
      return [];
    }

    // Look up the Raid Ledger user linked to this Discord ID
    const [linkedUser] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordId))
      .limit(1);

    if (!linkedUser) {
      return [];
    }

    const parsedGameId = gameId ? parseInt(gameId, 10) : undefined;
    const result = await this.charactersService.findAllForUser(
      linkedUser.id,
      parsedGameId || undefined,
    );
    return result.data;
  }
}
