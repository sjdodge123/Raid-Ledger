/**
 * DemoTestFixtureUserController (ROK-1276).
 *
 * Single endpoint `POST /admin/test/seed-fixture-user` that returns a stable
 * non-admin (`role: 'member'`) user for smoke tests, idempotently keyed on a
 * fixed `discord_id`. Used by the lineup-confirmation-pills-invitee smoke
 * spec (and any future smoke spec that needs to drive UI as an invitee
 * rather than admin-as-creator → organizer).
 *
 * Idempotency: SELECT by `discord_id = 'smoke-invitee-fixture-001'`; if no
 * row exists, INSERT one. Either path mints a fresh JWT via `AuthService`.
 * Re-calling returns the same `userId` + `discordId` with a new JWT.
 *
 * Off in production (env + DB `DEMO_MODE` flag both required).
 */
import {
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
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { AuthService } from '../auth/auth.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

/** Stable identifier for the smoke invitee fixture row. */
const SMOKE_INVITEE_DISCORD_ID = 'smoke-invitee-fixture-001';
const SMOKE_INVITEE_USERNAME = 'smoke-invitee-fixture';

export interface SeedFixtureUserResponse {
  userId: number;
  discordId: string;
  jwt: string;
}

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestFixtureUserController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly authService: AuthService,
  ) {}

  /** Idempotent: SELECT-or-INSERT by stable discord_id, return fresh JWT. */
  @Post('seed-fixture-user')
  @HttpCode(HttpStatus.OK)
  async seedFixtureUser(): Promise<SeedFixtureUserResponse> {
    await this.assertDemoMode();
    const user = await this.findOrCreateFixtureUser();
    const { access_token } = this.authService.login({
      id: user.id,
      username: user.username,
      role: user.role,
    });
    return {
      userId: user.id,
      discordId: SMOKE_INVITEE_DISCORD_ID,
      jwt: access_token,
    };
  }

  private async findOrCreateFixtureUser() {
    const existing = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.discordId, SMOKE_INVITEE_DISCORD_ID))
      .limit(1);
    if (existing[0]) {
      // Ensure pre-existing fixture rows have onboarding completed so the
      // wizard never blocks the lineup detail view, and are ACTIVE — the
      // daily guild-membership cron deactivates this synthetic user (no real
      // Discord membership), which then 404s invitee validation in
      // `addInvitees` (activeUsersFilter). Idempotent.
      await this.db
        .update(schema.users)
        .set({ onboardingCompletedAt: new Date(), deactivatedAt: null })
        .where(eq(schema.users.id, existing[0].id));
      return existing[0];
    }
    const [created] = await this.db
      .insert(schema.users)
      .values({
        discordId: SMOKE_INVITEE_DISCORD_ID,
        username: SMOKE_INVITEE_USERNAME,
        role: 'member',
        onboardingCompletedAt: new Date(),
      })
      .returning({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
      });
    return created;
  }

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    if (!(await this.settings.getDemoMode())) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }
}
