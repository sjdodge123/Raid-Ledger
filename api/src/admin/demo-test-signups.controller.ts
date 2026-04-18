import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoTestService } from './demo-test.service';
import {
  TriggerDepartureSchema,
  CancelSignupSchema,
  CreateTestSignupSchema,
} from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

/**
 * Signup test endpoints — DEMO_MODE only (smoke tests).
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestSignupsController {
  constructor(private readonly demoTestService: DemoTestService) {}

  /** Create a signup for any user -- DEMO_MODE only (smoke tests). */
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  async createSignupForTest(@Body() body: unknown): Promise<unknown> {
    const parsed = parseDemoBody(CreateTestSignupSchema, body);
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

  /** Enqueue a departure grace job with 0 delay — DEMO_MODE only (smoke tests). */
  @Post('trigger-departure')
  @HttpCode(HttpStatus.OK)
  async triggerDepartureForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(TriggerDepartureSchema, body);
    await this.demoTestService.triggerDepartureForTest(
      parsed.eventId,
      parsed.signupId,
      parsed.discordUserId,
    );
    return { success: true };
  }

  /** Cancel a user's signup (triggers bufferLeave) — DEMO_MODE only. */
  @Post('cancel-signup')
  @HttpCode(HttpStatus.OK)
  async cancelSignupForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(CancelSignupSchema, body);
    await this.demoTestService.cancelSignupForTest(
      parsed.eventId,
      parsed.userId,
    );
    return { success: true };
  }
}
