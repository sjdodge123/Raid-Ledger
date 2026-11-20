import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DemoTestService } from './demo-test.service';
import {
  TriggerDepartureSchema,
  CancelSignupSchema,
  CreateTestSignupSchema,
} from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';
import {
  RunningLateTestSchema,
  setRunningLateForTest,
} from './demo-test-signups.helpers';

/**
 * Signup test endpoints — DEMO_MODE only (smoke tests).
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestSignupsController {
  constructor(
    private readonly demoTestService: DemoTestService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Create a signup for any user -- DEMO_MODE only (smoke tests). */
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  async createSignupForTest(@Body() body: unknown): Promise<unknown> {
    const { eventId, userId, preferredRoles, characterId, status } =
      parseDemoBody(CreateTestSignupSchema, body);
    return this.demoTestService.createSignupForTest(eventId, userId, {
      ...(preferredRoles !== undefined ? { preferredRoles } : {}),
      ...(characterId !== undefined ? { characterId } : {}),
      ...(status !== undefined ? { status } : {}),
    });
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

  /**
   * Mark / clear running late via RunningLateService (urgent thread line,
   * ROK-2271) — DEMO_MODE only. Body `{ eventId, userId, minutes?, clear? }`.
   */
  @Post('running-late')
  @HttpCode(HttpStatus.OK)
  async runningLateForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean; changed: boolean }> {
    const parsed = parseDemoBody(RunningLateTestSchema, body);
    const { changed } = await setRunningLateForTest(this.moduleRef, parsed);
    return { success: true, changed };
  }
}
