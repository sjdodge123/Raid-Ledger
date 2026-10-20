/**
 * ROK-1598 (spec §2.7, D10–D13): `POST /users/me/calendars/apple` — connect
 * an iCloud calendar with an email + app-specific password.
 *
 * JWT + kill switch (off → 404), 5 attempts / 10 min per user (D13). Errors
 * are fixed `AppleConnectError` bodies that never echo the input (D11):
 * `invalid_input` 400 + `fields`, `apple_auth_failed` 400, `apple_unavailable`
 * 503 (anything unexpected also reaches Sentry — never a 500). Success = the
 * `CalendarConnection`: 201 created, 200 reconnected. The password lives in
 * memory for this request only; it is stored solely encrypted.
 */
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { AuthGuard } from '@nestjs/passport';
import * as Sentry from '@sentry/nestjs';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AppleConnectInputSchema,
  type AppleConnectError,
  type AppleConnectInput,
  type CalendarConnection,
} from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { AuthenticatedRequest } from '../../auth/types';
import { SettingsService } from '../../settings/settings.service';
import { CalendarSyncEnabledGuard } from '../calendar-sync-enabled.guard';
import {
  CALENDAR_READ_QUEUE,
  CALENDAR_WRITE_QUEUE,
} from '../calendar-sync.constants';
import { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { PerUserAttemptWindow } from './calendar-apple-throttle.helpers';
import {
  connectApple,
  finishAppleConnect,
  type AppleConnectDeps,
} from './calendar-apple-connect.helpers';

@Controller('users/me/calendars')
export class CalendarAppleController {
  private readonly logger = new Logger(CalendarAppleController.name);
  private readonly attempts = new PerUserAttemptWindow();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly registry: CalendarProviderRegistry,
    @InjectQueue(CALENDAR_WRITE_QUEUE) private readonly writeQueue: Queue,
    @InjectQueue(CALENDAR_READ_QUEUE) private readonly readQueue: Queue,
  ) {}

  @Post('apple')
  @UseGuards(AuthGuard('jwt'), CalendarSyncEnabledGuard)
  async connect(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CalendarConnection> {
    const input = this.admit(req.user.id, body);
    const provider = this.registry.getPasswordProvider('apple');
    if (!provider) throw new NotFoundException();
    const deps = this.deps();
    const outcome = await connectApple(deps, provider, req.user.id, input);
    if ('refused' in outcome) throw refusalOf(outcome.refused);
    const created = outcome.outcome === 'created';
    const connection = await finishAppleConnect(
      deps,
      req.user.id,
      outcome.id,
      created,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return connection;
  }

  /** D13 throttle, then the D11 schema check (never Zod's message). */
  private admit(userId: number, body: unknown): AppleConnectInput {
    if (!this.attempts.tryAttempt(userId)) {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const parsed = AppleConnectInputSchema.safeParse(body);
    if (parsed.success) return parsed.data;
    const paths = parsed.error.issues.map((i) => i.path.join('.'));
    const fields = [...new Set(paths)];
    return thrown({ code: 'invalid_input', fields }, HttpStatus.BAD_REQUEST);
  }

  private deps(): AppleConnectDeps {
    return {
      db: this.db,
      settings: this.settings,
      writeQueue: this.writeQueue,
      readQueue: this.readQueue,
      onUnexpected: (err) => {
        Sentry.captureException(err);
        const name = err instanceof Error ? err.constructor.name : typeof err;
        this.logger.error(`apple calendar connect failed (${name})`);
      },
    };
  }
}

function thrown(body: AppleConnectError, status: HttpStatus): never {
  throw new HttpException(body, status);
}

function refusalOf(code: AppleConnectError['code']): HttpException {
  const status =
    code === 'apple_unavailable'
      ? HttpStatus.SERVICE_UNAVAILABLE
      : HttpStatus.BAD_REQUEST;
  return new HttpException({ code }, status);
}
