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
import { SetEventTimesSchema } from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';

/**
 * Discord scheduled-event test endpoints — DEMO_MODE only.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestScheduledEventsController {
  constructor(private readonly demoTestService: DemoTestService) {}

  /** Trigger scheduled event completion cron — DEMO_MODE only (ROK-944). */
  @Post('trigger-scheduled-event-completion')
  @HttpCode(HttpStatus.OK)
  async triggerScheduledEventCompletionForTest(): Promise<{
    success: boolean;
  }> {
    return this.demoTestService.triggerScheduledEventCompletionForTest();
  }

  /** Pause the reconciliation cron to prevent API queue flooding — DEMO_MODE only (ROK-969). */
  @Post('pause-reconciliation')
  @HttpCode(HttpStatus.OK)
  async pauseReconciliationForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.pauseReconciliationForTest();
  }

  /** Enable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  @Post('enable-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async enableScheduledEventsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.enableScheduledEventsForTest();
  }

  /** Disable Discord scheduled event creation -- DEMO_MODE only (ROK-969). */
  @Post('disable-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async disableScheduledEventsForTest(): Promise<{ success: boolean }> {
    return this.demoTestService.disableScheduledEventsForTest();
  }

  /** Delete all Discord scheduled events in the guild — DEMO_MODE only (ROK-969). */
  @Post('cleanup-scheduled-events')
  @HttpCode(HttpStatus.OK)
  async cleanupScheduledEventsForTest() {
    return this.demoTestService.cleanupScheduledEventsForTest();
  }

  /** Force-set event times bypassing Zod validation — DEMO_MODE only (ROK-969). */
  @Post('set-event-times')
  @HttpCode(HttpStatus.OK)
  async setEventTimesForTest(@Body() body: unknown) {
    const parsed = parseDemoBody(SetEventTimesSchema, body);
    return this.demoTestService.setEventTimesForTest(
      parsed.eventId,
      parsed.startTime,
      parsed.endTime,
    );
  }
}
