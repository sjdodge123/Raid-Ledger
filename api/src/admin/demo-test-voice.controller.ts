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
  TriggerClassifySchema,
  InjectVoiceSessionSchema,
} from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

/**
 * Voice session test endpoints — DEMO_MODE only (smoke tests).
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestVoiceController {
  constructor(private readonly demoTestService: DemoTestService) {}

  /** Flush voice attendance sessions to the DB — DEMO_MODE only. */
  @Post('flush-voice-sessions')
  @HttpCode(HttpStatus.OK)
  async flushVoiceSessionsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.flushVoiceSessionsForTest();
  }

  /** Inject a synthetic voice session — DEMO_MODE only (ROK-943 smoke test). */
  @Post('inject-voice-session')
  @HttpCode(HttpStatus.OK)
  async injectVoiceSessionForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(InjectVoiceSessionSchema, body);
    await this.demoTestService.injectVoiceSessionForTest(parsed);
    return { success: true };
  }

  /** Trigger voice classification for an event — DEMO_MODE only (ROK-943). */
  @Post('trigger-classify')
  @HttpCode(HttpStatus.OK)
  async triggerClassifyForTest(
    @Body() body: unknown,
  ): Promise<{ success: boolean }> {
    const parsed = parseDemoBody(TriggerClassifySchema, body);
    await this.demoTestService.triggerClassifyForTest(parsed.eventId);
    return { success: true };
  }
}
