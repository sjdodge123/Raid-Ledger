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
import { eq } from 'drizzle-orm';
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

  /** Idempotent: SELECT-or-INSERT by stable discord_id, return fresh JWT. */
  @Post('seed-fixture-user')
  @HttpCode(HttpStatus.OK)
  async seedFixtureUser(
    @Body() body?: unknown,
  ): Promise<SeedFixtureUserResponse> {
    await this.assertDemoMode();
    const identity = fixtureIdentity(parseFixtureSlot(body));
    const user = await this.findOrCreateFixtureUser(identity);
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

  private async findOrCreateFixtureUser(identity: {
    discordId: string;
    username: string;
  }) {
    const existing = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.discordId, identity.discordId))
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
        discordId: identity.discordId,
        username: identity.username,
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
