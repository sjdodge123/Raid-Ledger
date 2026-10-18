/**
 * DemoTestIntentTokenController — `POST /admin/test/intent-token` (ROK-1841).
 *
 * Mints a REDEEMABLE join intent token outside Discord so Playwright can
 * prove the whole `/join?token=…` flow, not just its error states. The token
 * comes from `IntentTokenService.generate` — the same signer, claim shape and
 * 15-minute TTL the bot's "Join & Sign Up" button uses — so nothing here
 * duplicates the wire format, and `POST /auth/redeem-intent` accepts it.
 *
 * DEMO_MODE only (env + DB flag, via `DemoModeGuard`) and admin-gated like
 * every sibling `admin/test` controller. The response carries a live token —
 * never log it.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { IntentTokenService } from '../auth/intent-token.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  isSameOrigin,
  resolveClientUrl,
} from './demo-test-sign-in-link.helpers';
import {
  buildJoinUrl,
  INTENT_TOKEN_TTL_SECONDS,
  type IntentTokenResponse,
  parseIntentTokenBody,
  PLACEHOLDER_DISCORD_ID,
} from './demo-test-intent-token.helpers';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestIntentTokenController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly intentTokenService: IntentTokenService,
  ) {}

  /** Mint a join intent token for an existing event (and optionally a user). */
  @Post('intent-token')
  @HttpCode(HttpStatus.OK)
  async intentToken(@Body() body: unknown): Promise<IntentTokenResponse> {
    const { eventId, intent, userId } = parseIntentTokenBody(body);
    const clientUrl = resolveClientUrl();
    if (!clientUrl) {
      throw new InternalServerErrorException('CLIENT_URL is not configured');
    }
    await this.assertEventExists(eventId);
    const discordId = await this.resolveDiscordId(userId);
    const token = this.intentTokenService.generate(eventId, discordId);
    const url = buildJoinUrl(clientUrl, eventId, intent, token);
    if (!isSameOrigin(url, clientUrl)) {
      throw new InternalServerErrorException('Join link left the origin');
    }
    return {
      token,
      url,
      eventId,
      intent,
      discordId,
      expiresInSeconds: INTENT_TOKEN_TTL_SECONDS,
    };
  }

  private async assertEventExists(eventId: number): Promise<void> {
    const [row] = await this.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row) throw new NotFoundException(`Event ${eventId} not found`);
  }

  /**
   * A named user's real `discordId` keeps the redeem path's mismatch check
   * happy. A user without one (and the no-user case) gets the placeholder:
   * the check only fires when the signed-in user HAS a `discordId`.
   */
  private async resolveDiscordId(userId: number | null): Promise<string> {
    if (userId === null) return PLACEHOLDER_DISCORD_ID;
    const [row] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!row) throw new NotFoundException(`User ${userId} not found`);
    return row.discordId ?? PLACEHOLDER_DISCORD_ID;
  }
}
