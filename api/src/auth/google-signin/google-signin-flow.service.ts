/**
 * ROK-2371: the Google sign-in callback. Order matters (spec §8): signed
 * state → browser-binding cookie → seed spent once → THEN the code exchange.
 *
 * Logs only `google-signin ok user=<id>` / `refused reason=<r>` — never the
 * code, state, tokens, id_token, email or sub.
 */
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Request, Response } from 'express';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import {
  exchangeGoogleCode,
  type GoogleClient,
} from '../../calendar-sync/providers/google/google-oauth.helpers';
import { isLinkedDiscordId } from '../../guilds/community/discord-guild-member.helpers';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { browserBoundCookieAttrs } from '../browser-bound-cookie.helpers';
import { assertLinkStateBoundToBrowser } from '../link-state-cookie.helpers';
import {
  deriveSigninNonce,
  deriveSigninVerifier,
  GOOGLE_SIGNIN_CALLBACK_PATH,
  GOOGLE_SIGNIN_SEED_PREFIX,
  GOOGLE_SIGNIN_STATE_TTL_SECONDS,
  googleRedirectUri,
  signGoogleSigninState,
  verifyGoogleSigninState,
  type GoogleSigninAction,
  type GoogleSigninState,
} from './google-signin-oauth.helpers';
import {
  readGoogleSigninClaims,
  refusalRedirect,
  signinRefusalFor,
  type GoogleSigninClaims,
  type SigninRefusal,
} from './google-signin-claims.helpers';
import { GoogleSigninService, type UserRow } from './google-signin.service';
import { PendingIdentityStore } from './pending-identity.store';
import { exchangeFailureClass } from './google-signin-errors.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface CallbackQuery {
  code: unknown;
  state: unknown;
}

@Injectable()
export class GoogleSigninFlowService {
  private readonly logger = new Logger('GoogleSignin');

  constructor(
    private readonly svc: GoogleSigninService,
    private readonly pending: PendingIdentityStore,
    private readonly jwt: JwtService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
  ) {}

  /** Mint a signed state bound to this browser's `r`. */
  mintState(
    action: GoogleSigninAction,
    r: string,
  ): { state: string; n: string } {
    return signGoogleSigninState(this.jwt, { action, r });
  }

  /** Verify state + this browser's binding cookie; null on any mismatch. */
  verifyBoundState(
    req: Request,
    res: Response,
    token: unknown,
  ): GoogleSigninState | null {
    const state = verifyGoogleSigninState(this.jwt, token);
    if (!state) return null;
    try {
      assertLinkStateBoundToBrowser(
        req,
        res,
        'google-signin',
        state.r,
        browserBoundCookieAttrs(req),
      );
    } catch {
      return null;
    }
    return state;
  }

  /** The callback: returns the absolute URL to redirect to. */
  async handleCallback(
    req: Request,
    res: Response,
    client: GoogleClient,
    q: CallbackQuery,
  ): Promise<string> {
    const base = await this.svc.clientUrl();
    const state = this.verifyBoundState(req, res, q.state);
    if (!state || typeof q.code !== 'string' || !q.code) {
      return this.refuse(base, { reason: 'oauth_failed' }, 'state');
    }
    const fresh = await this.svc.consumeSeedOnce(
      `${GOOGLE_SIGNIN_SEED_PREFIX}${state.n}`,
      GOOGLE_SIGNIN_STATE_TTL_SECONDS,
    );
    if (!fresh) return this.refuse(base, { reason: 'oauth_failed' }, 'replay');
    const claims = await this.exchange(client, q.code, state.n, base);
    if (!claims)
      return this.refuse(base, { reason: 'oauth_failed' }, 'exchange');
    if (state.action === 'pending-link') {
      return this.completePendingLink(req, res, base, claims);
    }
    if (state.action !== 'signin') {
      return this.refuse(base, { reason: 'oauth_failed' }, 'action');
    }
    return this.signIn(req, res, base, claims);
  }

  private async exchange(
    client: GoogleClient,
    code: string,
    n: string,
    base: string,
  ): Promise<GoogleSigninClaims | null> {
    try {
      const tokens = await exchangeGoogleCode(client, {
        code,
        codeVerifier: deriveSigninVerifier(n),
        redirectUri: googleRedirectUri(base, GOOGLE_SIGNIN_CALLBACK_PATH),
      });
      if (!tokens.idToken) return null;
      return readGoogleSigninClaims(
        tokens.idToken,
        client.clientId,
        deriveSigninNonce(n),
      );
    } catch (err) {
      this.logger.warn(
        `google-signin exchange failed ${exchangeFailureClass(err)}`,
      );
      return null;
    }
  }

  /** Known `sub` → refusals or a session; unknown → D1a pending identity. */
  private async signIn(
    req: Request,
    res: Response,
    base: string,
    claims: GoogleSigninClaims,
  ): Promise<string> {
    const user = await this.svc.findUserBySub(claims.sub);
    if (user) return this.signInKnown(req, res, base, user, claims.sub);
    if (!claims.emailVerified) {
      return this.refuse(base, { reason: 'unverified' }, 'unverified');
    }
    await this.pending.create(req, res, {
      provider: 'google',
      subject: claims.sub,
      displayName: claims.displayName,
      email: claims.email,
      avatar: null,
    });
    this.logger.log('google-signin pending identity parked');
    return `${base}/auth/first-time`;
  }

  private async signInKnown(
    req: Request,
    res: Response,
    base: string,
    user: UserRow,
    sub: string,
  ): Promise<string> {
    const refusal = await signinRefusalFor(this.db, user);
    if (refusal) return this.refuse(base, refusal, refusal.reason);
    await this.svc.touchLastUsed(sub);
    this.logger.log(`google-signin ok user=${user.id}`);
    return `${base}${await this.svc.issueSession(req, res, user, 'google')}`;
  }

  /**
   * D1a "I already have an account": a pending DISCORD identity is proven to
   * belong to the account this Google sign-in finds, and is linked to it.
   */
  private async completePendingLink(
    req: Request,
    res: Response,
    base: string,
    claims: GoogleSigninClaims,
  ): Promise<string> {
    const pending = await this.pending.peek(req);
    if (!pending || pending.provider !== 'discord') {
      return `${base}/auth/first-time?error=expired`;
    }
    const user = await this.svc.findUserBySub(claims.sub);
    if (!user) return `${base}/auth/first-time?error=not_found`;
    const refusal = await signinRefusalFor(this.db, user);
    if (refusal) return this.refuse(base, refusal, refusal.reason);
    if (
      isLinkedDiscordId(user.discordId) &&
      user.discordId !== pending.subject
    ) {
      return `${base}/auth/first-time?error=already_linked`;
    }
    const spent = await this.pending.consume(req, res);
    if (spent?.provider !== 'discord' || spent.subject !== pending.subject) {
      return `${base}/auth/first-time?error=expired`;
    }
    return this.linkPendingDiscord(req, res, base, user, spent, claims.sub);
  }

  private async linkPendingDiscord(
    req: Request,
    res: Response,
    base: string,
    user: UserRow,
    pending: { subject: string; displayName: string; avatar: string | null },
    sub: string,
  ): Promise<string> {
    try {
      await this.usersService.linkDiscord(
        user.id,
        pending.subject,
        pending.displayName,
        pending.avatar,
      );
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      return `${base}/auth/first-time?error=taken`;
    }
    this.authService.emitDiscordLogin(user.id, pending.subject);
    await this.svc.touchLastUsed(sub);
    this.logger.log(`google-signin ok user=${user.id} pending-link=discord`);
    return `${base}${await this.svc.issueSession(req, res, user, 'google')}`;
  }

  private refuse(
    base: string,
    refusal: SigninRefusal,
    logReason: string,
  ): string {
    this.logger.log(`google-signin refused reason=${logReason}`);
    return refusalRedirect(base, refusal);
  }
}
