/**
 * ROK-1866 Lane C: DEMO_MODE-only fixtures for the reconnect-nudge smoke.
 *
 *   - `POST /admin/test/calendar/fail-read-auth` scripts the Fake's next
 *     `fetchBusy` to reject with `invalid_grant` and runs ONE real read sync
 *     through `CalendarReadProcessor.process` (F1). The row flips to
 *     `needs_reconnect` and the processor emits the nudge event, as in prod.
 *   - `POST /admin/test/calendar/emit-needs-reconnect` re-emits the event for
 *     a connection and awaits the listener — a further auth failure from any
 *     site on the same episode. Returns whether a nudge was claimed.
 *
 * Gated exactly like `CalendarDemoSeedController`: JWT + AdminGuard +
 * DemoModeGuard, then env `DEMO_MODE=true` AND the `demo_mode` setting.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { AdminGuard } from '../../auth/admin.guard';
import { DemoModeGuard } from '../../admin/demo-mode.guard';
import { parseDemoBody } from '../../admin/demo-test.utils';
import { SettingsService } from '../../settings/settings.service';
import {
  CALENDAR_FAKE_PROVIDER,
  isDemoFakeSubject,
} from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { ProviderAuthError } from '../providers/calendar-provider.errors';
import { CalendarReadProcessor } from '../read/calendar-read.processor';
import type { CalendarReadJobData } from '../read/calendar-read.enqueue.helpers';
import { CALENDAR_NEEDS_RECONNECT_EVENT } from '../calendar-needs-reconnect.events';

const DEMO_ONLY = 'Only available in DEMO_MODE';

const ConnectionBodySchema = z
  .object({ connectionId: z.number().int().positive() })
  .strict();

export interface FailReadAuthResult {
  outcome: string;
  userId: number;
  status: string;
}

/** One attempt, final: the auth decision never retries anyway. */
function syncJob(connectionId: number): Job<CalendarReadJobData> {
  return {
    data: { kind: 'sync', connectionId },
    attemptsMade: 0,
    opts: { attempts: 1 },
  } as unknown as Job<CalendarReadJobData>;
}

@Controller('admin/test/calendar')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class CalendarDemoAuthFailureController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    @Inject(CALENDAR_FAKE_PROVIDER)
    private readonly fake: FakeCalendarProvider,
    private readonly readProcessor: CalendarReadProcessor,
    private readonly emitter: EventEmitter2,
  ) {}

  @Post('fail-read-auth')
  @HttpCode(HttpStatus.OK)
  async failReadAuth(@Body() body: unknown): Promise<FailReadAuthResult> {
    await this.assertDemoMode();
    const { connectionId } = parseDemoBody(ConnectionBodySchema, body ?? {});
    await this.assertDemoConnection(connectionId);
    const c = schema.calendarConnections;
    await this.db
      .update(c)
      .set({ readAccessGranted: true, readEnabled: true })
      .where(eq(c.id, connectionId));
    this.fake.failNextFetch(new ProviderAuthError('invalid_grant'));
    const outcome = await this.runOnce(connectionId);
    const [row] = await this.db.select().from(c).where(eq(c.id, connectionId));
    return {
      outcome,
      userId: row?.userId ?? 0,
      status: row?.status ?? 'missing',
    };
  }

  @Post('emit-needs-reconnect')
  @HttpCode(HttpStatus.OK)
  async emitNeedsReconnect(
    @Body() body: unknown,
  ): Promise<{ nudged: boolean }> {
    await this.assertDemoMode();
    const { connectionId } = parseDemoBody(ConnectionBodySchema, body ?? {});
    await this.assertDemoConnection(connectionId);
    const results: unknown[] = await this.emitter.emitAsync(
      CALENDAR_NEEDS_RECONNECT_EVENT,
      { connectionId },
    );
    return { nudged: results.some((r) => r === true) };
  }

  /** Only demo Fake connections — never a real user's Google/Apple tokens. */
  private async assertDemoConnection(connectionId: number): Promise<void> {
    const c = schema.calendarConnections;
    const [row] = await this.db
      .select({ subject: c.accountSubject })
      .from(c)
      .where(eq(c.id, connectionId));
    if (!row || !isDemoFakeSubject(row.subject)) {
      throw new ForbiddenException('Only demo calendar connections');
    }
  }

  /** The processor throws on a failed sync; that is the expected path. */
  private async runOnce(connectionId: number): Promise<string> {
    try {
      return String(await this.readProcessor.process(syncJob(connectionId)));
    } catch {
      return 'failed';
    } finally {
      this.fake.store.clearFailures(); // never leak the scripted failure
    }
  }

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException(DEMO_ONLY);
    }
    if (!(await this.settings.getDemoMode())) {
      throw new ForbiddenException(DEMO_ONLY);
    }
  }
}
