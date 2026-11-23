/**
 * DemoTestAddonErrorsController (ROK-2099 S3) —
 * `POST /admin/test/wow/seed-addon-errors` (no body).
 *
 * (Re)creates three demo uploaders and gives them a fixed set of scrubbed
 * addon-error records across three addons (one group shared by two members),
 * for the S4 admin page's Playwright spec and fleet test plan. Idempotent.
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DemoModeGuard } from './demo-mode.guard';
import {
  seedAddonErrors,
  type SeedAddonErrorsResult,
} from './demo-test-addon-errors.helpers';

@Controller('admin/test/wow')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestAddonErrorsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Post('seed-addon-errors')
  @HttpCode(HttpStatus.OK)
  seed(): Promise<SeedAddonErrorsResult> {
    return seedAddonErrors(this.db, new Date());
  }
}
