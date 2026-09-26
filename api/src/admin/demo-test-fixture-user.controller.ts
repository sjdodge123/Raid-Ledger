/**
 * DemoTestFixtureUserController (ROK-1276).
 *
 * Single endpoint `POST /admin/test/seed-fixture-user` that returns a stable
 * non-admin (`role: 'member'`) user for smoke tests, idempotently keyed on a
 * fixed `discord_id`. Used by the lineup-confirmation-pills-invitee smoke
 * spec (and any future smoke spec that needs to drive UI as an invitee
 * rather than admin-as-creator → organizer).
 *
 * Idempotency: a single INSERT ... ON CONFLICT (discord_id) DO UPDATE keyed
 * on `discord_id = 'smoke-invitee-fixture-001'`, then a fresh JWT via
 * `AuthService`. Re-calling (even concurrently) returns the same `userId` +
 * `discordId` with a new JWT.
 *
 * Off in production (env + DB `DEMO_MODE` flag both required).
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
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { AuthService } from '../auth/auth.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

/** Stable identifier for the smoke invitee fixture row (slot 1). */
const SMOKE_INVITEE_DISCORD_ID = 'smoke-invitee-fixture-001';
const SMOKE_INVITEE_USERNAME = 'smoke-invitee-fixture';
/** Slots 1..9: a smoke that needs SEVERAL distinct non-admin users. */
const MAX_SLOT = 9;

/**
 * The stable identity of fixture slot `n`. Slot 1 is the original row every
 * pre-existing smoke relies on; higher slots are distinct rows (ROK-1454's
 * LFM lifecycle needs a third hand that is NOT the second one).
 */
export function fixtureIdentity(slot: number): {
  discordId: string;
  username: string;
} {
  if (slot === 1) {
    return {
      discordId: SMOKE_INVITEE_DISCORD_ID,
      username: SMOKE_INVITEE_USERNAME,
    };
  }
  return {
    discordId: `smoke-invitee-fixture-00${String(slot)}`,
    username: `${SMOKE_INVITEE_USERNAME}-${String(slot)}`,
  };
}

/** Body → slot: integers 1..9 only; anything else is slot 1. */
export function parseFixtureSlot(body: unknown): number {
  const slot = (body as { slot?: unknown } | null)?.slot;
  return typeof slot === 'number' &&
    Number.isInteger(slot) &&
    slot >= 1 &&
    slot <= MAX_SLOT
    ? slot
    : 1;
}

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

  /** Idempotent: upsert by stable discord_id, return fresh JWT. */
  @Post('seed-fixture-user')
  @HttpCode(HttpStatus.OK)
  async seedFixtureUser(
    @Body() body?: unknown,
  ): Promise<SeedFixtureUserResponse> {
    await this.assertDemoMode();
    const identity = fixtureIdentity(parseFixtureSlot(body));
    const user = await this.upsertFixtureUser(identity);
    const { access_token } = this.authService.login({
      id: user.id,
      username: user.username,
      role: user.role,
    });
    return {
      userId: user.id,
      discordId: identity.discordId,
      jwt: access_token,
    };
  }

  /**
   * One atomic upsert keyed on the UNIQUE `discord_id`, so two concurrent
   * calls both land on the same row instead of the loser 500ing on the
   * constraint (a SELECT-then-INSERT raced here).
   *
   * On conflict the row is re-marked onboarded (so the wizard never blocks
   * the lineup detail view) and ACTIVE — the daily guild-membership cron
   * deactivates this synthetic user (no real Discord membership), which then
   * 404s invitee validation in `addInvitees` (activeUsersFilter).
   */
  private async upsertFixtureUser(identity: {
    discordId: string;
    username: string;
  }) {
    const [user] = await this.db
      .insert(schema.users)
      .values({
        discordId: identity.discordId,
        username: identity.username,
        role: 'member',
        onboardingCompletedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.users.discordId,
        set: { onboardingCompletedAt: new Date(), deactivatedAt: null },
      })
      .returning({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
      });
    return user;
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
