import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard';
import { DemoTestService } from './demo-test.service';

const LinkDiscordSchema = z.object({
  userId: z.number().int().positive(),
  discordId: z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID format'),
  username: z.string().min(1).max(100),
});

const EnableNotificationsSchema = z.object({
  userId: z.number().int().positive(),
});

const VALID_ROLES = [
  'tank', 'healer', 'dps', 'flex', 'player', 'bench',
] as const;

const VALID_STATUSES = ['signed_up', 'tentative', 'declined'] as const;

const CreateTestSignupSchema = z.object({
  eventId: z.number().int().positive(),
  userId: z.number().int().positive(),
  preferredRoles: z.array(z.enum(VALID_ROLES)).optional(),
  characterId: z.string().uuid().optional(),
  status: z.enum(VALID_STATUSES).optional(),
});

/**
 * Controller for demo/test-only endpoints used by smoke tests.
 * All endpoints require admin auth and DEMO_MODE to be enabled.
 */
@Controller('admin/test')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestController {
  constructor(private readonly demoTestService: DemoTestService) {}

  /** Link a Discord ID to a user -- DEMO_MODE only (smoke tests). */
  @Post('link-discord')
  @HttpCode(HttpStatus.OK)
  async linkDiscordForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean; user: unknown }> {
    const parsed = this.parseBody(LinkDiscordSchema, body);
    const user = await this.demoTestService.linkDiscordForTest(
      parsed.userId,
      parsed.discordId,
      parsed.username,
    );
    return { success: true, user };
  }

  /** Enable Discord DM notifications for a user -- DEMO_MODE only. */
  @Post('enable-discord-notifications')
  @HttpCode(HttpStatus.OK)
  async enableDiscordNotificationsForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = this.parseBody(EnableNotificationsSchema, body);
    await this.demoTestService.enableDiscordNotificationsForTest(
      parsed.userId,
    );
    return { success: true };
  }

  /** Create a signup for any user -- DEMO_MODE only (smoke tests). */
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  async createSignupForTest(@Body() body: unknown): Promise<unknown> {
    const parsed = this.parseBody(CreateTestSignupSchema, body);
    return this.demoTestService.createSignupForTest(
      parsed.eventId,
      parsed.userId,
      {
        preferredRoles: parsed.preferredRoles,
        characterId: parsed.characterId,
        status: parsed.status,
      },
    );
  }

  /** Parse and validate body with a Zod schema, throwing 400 on failure. */
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
