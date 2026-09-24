/**
 * DemoTestSignInLinkController — `POST /admin/test/sign-in-link`.
 *
 * Lets an agent verifying UI on a fleet env sign in as a seeded user WITHOUT
 * typing a password: it mints a standard 15-minute magic link
 * (`MagicLinkService.generateLink`) that the web app consumes from `#token=`.
 *
 * DEMO_MODE only (env + DB flag) and admin-gated like every sibling
 * `admin/test` controller. The url carries a live token — never log it.
 */
import {
  Body,
  Controller,
  ForbiddenException,
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
import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { MagicLinkService } from '../auth/magic-link.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import {
  isSameOrigin,
  parseSignInLinkBody,
  resolveClientUrl,
  SIGN_IN_LINK_TTL_SECONDS,
  type SignInLinkResponse,
  type SignInLinkTarget,
} from './demo-test-sign-in-link.helpers';

@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestSignInLinkController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  private async assertDemoMode(): Promise<void> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const demoMode = await this.settingsService.getDemoMode();
    if (!demoMode) {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
  }

  /** Mint a sign-in URL for an existing user (by id or username). */
  @Post('sign-in-link')
  @HttpCode(HttpStatus.OK)
  async signInLink(@Body() body: unknown): Promise<SignInLinkResponse> {
    await this.assertDemoMode();
    const target = parseSignInLinkBody(body);
    const clientUrl = resolveClientUrl();
    if (!clientUrl) {
      throw new InternalServerErrorException('CLIENT_URL is not configured');
    }
    const userId = await this.resolveUserId(target);
    const url = await this.magicLinkService.generateLink(
      userId,
      target.path,
      clientUrl,
    );
    if (!url) throw new NotFoundException(`User ${userId} not found`);
    if (!isSameOrigin(url, clientUrl)) {
      throw new InternalServerErrorException('Sign-in link left the origin');
    }
    return { url, userId, expiresInSeconds: SIGN_IN_LINK_TTL_SECONDS };
  }

  /**
   * `users.username` is NOT unique (see ROK-1633), so a username resolves to
   * the lowest-id match — deterministic, and the seeded original wins.
   */
  private async resolveUserId(target: SignInLinkTarget): Promise<number> {
    if (target.kind === 'id') return target.userId;
    const [row] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, target.username))
      .orderBy(asc(schema.users.id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`User "${target.username}" not found`);
    }
    return row.id;
  }
}
