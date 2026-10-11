/**
 * DemoTestBrowserSessionController — `POST /admin/test/browser-session`.
 *
 * ROK-1754 §3.7: the access token lives only in memory, so a Playwright
 * browser context boots its session from the httpOnly `rl_rt` cookie. Each
 * call mints a NEW refresh family for `{ userId }` and sets that cookie, so
 * every context owns its own family — no cross-context replay, no reuse
 * revoke. Not `/auth/local`: its `auth` throttle tier is 10/min on DEMO_MODE.
 *
 * DEMO_MODE only (env + DB flag) behind JWT + AdminGuard, like every sibling
 * `admin/test` controller. Never log the cookie value.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { RefreshTokenService } from '../auth/refresh/refresh-token.service';
import { setRefreshCookie } from '../auth/refresh/refresh-cookie.helpers';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DemoModeGuard } from './demo-mode.guard';

/** Parse `{ userId }` — a positive integer — or throw 400. */
function parseUserId(body: unknown): number {
  const raw = (body as { userId?: unknown } | null)?.userId;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new BadRequestException('userId must be a positive integer');
  }
  return raw;
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestBrowserSessionController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly refreshService: RefreshTokenService,
  ) {}

  /** Mint a fresh refresh family for `userId` and set `rl_rt`. 204. */
  @Post('browser-session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async browserSession(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const userId = parseUserId(body);
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    const issued = await this.refreshService.issue(userId, {
      authMethod: 'local',
    });
    setRefreshCookie(res, issued.rawToken, issued.maxAgeMs);
  }
}
