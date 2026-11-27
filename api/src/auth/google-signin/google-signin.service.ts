/**
 * ROK-2371: Google sign-in data access + session issue. Identity lookups are
 * by Google `sub` only — never by email (ruling 1). Never stores a Google
 * access/refresh token.
 */
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { SettingsService } from '../../settings/settings.service';
import { getCalendarProviderConfig } from '../../settings/settings-calendar-sync.helpers';
import { getClientUrl } from '../../settings/settings-bot.helpers';
import {
  getGoogleSigninEnabled,
  googleSigninRedirectUris,
  type GoogleSigninRedirectUris,
} from '../../settings/settings-google-signin.helpers';
import { UsersService } from '../../users/users.service';
import type { GoogleClient } from '../../calendar-sync/providers/google/google-oauth.helpers';
import { AuthService } from '../auth.service';
import { mintBrowserBoundAuthCode } from '../auth-code-cookie.helpers';
import { RefreshTokenService } from '../refresh/refresh-token.service';
import { isUniqueViolation } from './google-signin-errors.helpers';
import { setRefreshCookie } from '../refresh/refresh-cookie.helpers';
import type { PendingIdentity } from './pending-identity.store';

type Db = PostgresJsDatabase<typeof schema>;
export type UserRow = typeof schema.users.$inferSelect;

export const GOOGLE_SUB_TAKEN_MESSAGE =
  'This Google account is already linked to another Raid Ledger account';

const { userAuthIdentities: identities, users } = schema;

@Injectable()
export class GoogleSigninService {
  constructor(
    private readonly settings: SettingsService,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly authService: AuthService,
    private readonly refreshService: RefreshTokenService,
    private readonly usersService: UsersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** The OAuth client, or null when the toggle is off or the client unset. */
  async getClient(): Promise<GoogleClient | null> {
    if (!(await getGoogleSigninEnabled(this.settings))) return null;
    const cfg = await getCalendarProviderConfig(this.settings, 'google', {
      includeSecret: true,
    });
    if (!cfg.clientId || !cfg.clientSecret) return null;
    return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
  }

  /** Whether Google sign-in is live (toggle on + client set). */
  async isEnabled(): Promise<boolean> {
    return (await this.getClient()) !== null;
  }

  /** `CLIENT_URL` without a trailing slash (same source as the admin URIs). */
  async clientUrl(): Promise<string> {
    return (await getClientUrl(this.settings)).replace(/\/+$/, '');
  }

  /** Exact Google redirect URI — the Discord callback's API base (§2). */
  async redirectUri(kind: keyof GoogleSigninRedirectUris): Promise<string> {
    return (await googleSigninRedirectUris(this.settings))[kind];
  }

  /** The user a Google `sub` is linked to, or null. */
  async findUserBySub(sub: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select({ user: users })
      .from(identities)
      .innerJoin(users, eq(users.id, identities.userId))
      .where(
        and(eq(identities.provider, 'google'), eq(identities.subject, sub)),
      )
      .limit(1);
    return row?.user ?? null;
  }

  async touchLastUsed(sub: string): Promise<void> {
    await this.db
      .update(identities)
      .set({ lastUsedAt: new Date() })
      .where(
        and(eq(identities.provider, 'google'), eq(identities.subject, sub)),
      );
  }

  /**
   * D1a "Create a new account": a `users` row with `discord_id NULL` plus the
   * identity. Pre-checks the `sub` (409); a racing create that still collides
   * rolls the whole transaction back and maps to the same 409 out here (no
   * retry inside the transaction).
   */
  async createGoogleUser(p: PendingIdentity): Promise<UserRow> {
    if (await this.findUserBySub(p.subject)) {
      throw new ConflictException(GOOGLE_SUB_TAKEN_MESSAGE);
    }
    let created: UserRow;
    try {
      created = await this.insertGoogleUser(p);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(GOOGLE_SUB_TAKEN_MESSAGE);
      }
      throw err;
    }
    this.usersService.invalidateCountCache();
    return created;
  }

  private insertGoogleUser(p: PendingIdentity): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ username: p.displayName, discordId: null, avatar: null })
        .returning();
      if (!user) throw new Error('insert users returned no row');
      await tx.insert(identities).values({
        userId: user.id,
        provider: 'google',
        subject: p.subject,
        email: p.email,
        lastUsedAt: new Date(),
      });
      return user;
    });
  }

  /**
   * Browser-bound one-time auth code + refresh family, then the SPA landing
   * path (`/auth/success?code=…&via=<method>`), relative to the client URL.
   */
  async issueSession(
    req: Request,
    res: Response,
    user: UserRow,
    method: 'google' | 'discord',
  ): Promise<string> {
    const { access_token } = await this.authService.login(user);
    const code = mintBrowserBoundAuthCode(req, res);
    await this.redis.setex(`auth_code:${code}`, 30, access_token);
    const issued = await this.refreshService.issue(user.id, {
      authMethod: method,
      userAgent: req.headers['user-agent'] ?? null,
    });
    setRefreshCookie(res, issued.rawToken, issued.maxAgeMs);
    return `/auth/success?code=${code}&via=${method}`;
  }

  /** Spend a state seed once; false when it was already used. */
  async consumeSeedOnce(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  }
}
