import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { AiChatService } from '../discord-bot/ai-chat/ai-chat.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema';
import {
  AiChatSimulateSchema,
  ExpireAiChatSessionSchema,
  SetAiChatEnabledSchema,
} from './demo-test.schemas';

/**
 * AI Chat test endpoints — DEMO_MODE only (ROK-566).
 * Extracted from DemoTestController to stay under 300-line limit.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AiChatTestController {
  constructor(
    private readonly aiChatService: AiChatService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('ai-chat-simulate')
  @HttpCode(HttpStatus.OK)
  async aiChatSimulate(@Body() body: unknown) {
    const parsed = this.parseBody(AiChatSimulateSchema, body);
    return this.aiChatService.handleInteraction(
      parsed.discordUserId,
      parsed.text,
      parsed.buttonId,
    );
  }

  @Post('expire-ai-chat-session')
  @HttpCode(HttpStatus.OK)
  expireAiChatSession(@Body() body: unknown) {
    const parsed = this.parseBody(ExpireAiChatSessionSchema, body);
    this.aiChatService.sessionStore.clear(parsed.discordUserId);
    return { success: true };
  }

  @Post('set-ai-chat-enabled')
  @HttpCode(HttpStatus.OK)
  async setAiChatEnabled(@Body() body: unknown) {
    const parsed = this.parseBody(SetAiChatEnabledSchema, body);
    await this.settingsService.set(
      SETTING_KEYS.AI_CHAT_ENABLED,
      String(parsed.enabled),
    );
    return { success: true };
  }

  private parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
      const messages = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new BadRequestException(`Validation failed: ${messages}`);
    }
    return result.data;
  }
}
