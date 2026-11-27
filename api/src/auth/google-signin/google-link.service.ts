/**
 * ROK-2371 §3 "Linking Google from Profile": the signed-in link flow.
 *
 * Callback order (spec §8): signed `link` state → this browser's
 * `rl_link_state_google` cookie → state seed spent once → THEN the code
 * exchange. The identity is keyed by Google `sub` only (never email).
 *
 * Logs only `google-link ok user=<id>` / `refused reason=<r>` — never the
 * code, state, tokens, id_token, email or sub.
 */
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Request, Response } from 'express';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  exchangeGoogleCode,
  type GoogleClient,
} from '../../calendar-sync/providers/google/google-oauth.helpers';
import { LINK_REQUEST_EXPIRED_MESSAGE } from '../link-nonce.service';
import {
  assertLinkStateBoundToBrowser,
  bindLinkStateToBrowser,
} from '../link-state-cookie.helpers';
import {
  buildGoogleSigninUrl,
  deriveSigninNonce,
  deriveSigninVerifier,
  GOOGLE_LINK_CALLBACK_PATH,
  GOOGLE_SIGNIN_SEED_PREFIX,
  GOOGLE_SIGNIN_STATE_TTL_SECONDS,
  googleRedirectUri,
  signGoogleSigninState,
  verifyGoogleSigninState,
} from './google-signin-oauth.helpers';
import {
  readGoogleSigninClaims,
  signinRefusalFor,
  type GoogleSigninClaims,
} from './google-signin-claims.helpers';
import {
  exchangeFailureClass,
  isUniqueViolation,
} from './google-signin-errors.helpers';
import {
  GOOGLE_SUB_TAKEN_MESSAGE,
  GoogleSigninService,
} from './google-signin.service';

type Db = PostgresJsDatabase<typeof schema>;
const { userAuthIdentities: identities, users } = schema;

export const UNLINK_CURRENT_GOOGLE_MESSAGE =
  'Unlink your current Google account first';
export const GOOGLE_LINK_FAILED_MESSAGE =
  'Could not link your Google account. Please try again.';
export const GOOGLE_LINK_UNVERIFIED_MESSAGE =
  'Google has not verified the email on that account, so it cannot be linked.';

/** Where every link hop lands (mirrors the Discord link). */
export const GOOGLE_LINK_RESULT_PATH = '/profile/integrations';

export interface GoogleLinkQuery {
  code: unknown;
  state: unknown;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Lock the user, then decide: false = this `sub` is already this user's
 * (idempotent); true = insert. Throws the two §3 409s.
 */
async function needsInsert(
  tx: Tx,
  userId: number,
  sub: string,
): Promise<boolean> {
  await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  const rows = await tx
    .select({ userId: identities.userId, subject: identities.subject })
    .from(identities)
    .where(
      and(
        eq(identities.provider, 'google'),
        or(eq(identities.userId, userId), eq(identities.subject, sub)),
      ),
    );
  if (rows.some((r) => r.userId === userId && r.subject === sub)) return false;
  if (rows.some((r) => r.userId !== userId)) {
    throw new ConflictException(GOOGLE_SUB_TAKEN_MESSAGE);
  }
  if (rows.length > 0)
    throw new ConflictException(UNLINK_CURRENT_GOOGLE_MESSAGE);
  return true;
}

@Injectable()
export class GoogleLinkService {
  private readonly logger = new Logger('GoogleLink');

  constructor(
    private readonly svc: GoogleSigninService,
    private readonly jwt: JwtService,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
  ) {}

  /** `${CLIENT_URL}/profile/integrations?linked=…&provider=google[…]`. */
  resultUrl(base: string, error?: string): string {
    const q = error
      ? `linked=error&provider=google&message=${encodeURIComponent(error)}`
      : 'linked=success&provider=google';
    return `${base}${GOOGLE_LINK_RESULT_PATH}?${q}`;
  }

  /** GET /auth/google/link hop: bind this browser, sign a `link` state. */
  authorizeUrl(
    res: Response,
    client: GoogleClient,
    base: string,
    userId: number,
  ): string {
    const r = bindLinkStateToBrowser(res, 'google');
    const { state, n } = signGoogleSigninState(this.jwt, {
      action: 'link',
      r,
      uid: userId,
    });
    return buildGoogleSigninUrl({
      clientId: client.clientId,
      redirectUri: googleRedirectUri(base, GOOGLE_LINK_CALLBACK_PATH),
      state,
      n,
    });
  }

  /** The link callback: returns the absolute URL to redirect to. */
  async handleCallback(
    req: Request,
    res: Response,
    client: GoogleClient,
    q: GoogleLinkQuery,
  ): Promise<string> {
    const base = await this.svc.clientUrl();
    const state = this.verifyBoundState(req, res, q.state);
    if (!state || typeof q.code !== 'string' || !q.code) {
      return this.refuse(base, LINK_REQUEST_EXPIRED_MESSAGE, 'state');
    }
    const blocked = await this.preExchangeRefusal(state);
    if (blocked) return this.refuse(base, blocked.message, blocked.reason);
    const claims = await this.exchange(client, q.code, state.n, base);
    if (!claims)
      return this.refuse(base, GOOGLE_LINK_FAILED_MESSAGE, 'exchange');
    if (!claims.emailVerified) {
      return this.refuse(base, GOOGLE_LINK_UNVERIFIED_MESSAGE, 'unverified');
    }
    try {
      await this.linkIdentity(state.uid, claims);
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      return this.refuse(base, err.message, 'conflict');
    }
    this.logger.log(`google-link ok user=${state.uid}`);
    return this.resultUrl(base);
  }

  /** Spend the seed once (replay → refused), then re-check the account. */
  private async preExchangeRefusal(state: {
    n: string;
    uid: number;
  }): Promise<{ message: string; reason: string } | null> {
    const key = `${GOOGLE_SIGNIN_SEED_PREFIX}${state.n}`;
    if (!(await this.svc.consumeSeedOnce(key, GOOGLE_SIGNIN_STATE_TTL_SECONDS)))
      return { message: LINK_REQUEST_EXPIRED_MESSAGE, reason: 'replay' };
    return this.accountRefusal(state.uid);
  }

  /**
   * Spec §8: ban / kick cooldown / deactivation re-checked at consume time
   * (the JWT was only checked at `/link/start`, up to 10 minutes earlier).
   */
  private async accountRefusal(
    uid: number,
  ): Promise<{ message: string; reason: string } | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);
    if (!user) return { message: LINK_REQUEST_EXPIRED_MESSAGE, reason: 'gone' };
    const refusal = await signinRefusalFor(this.db, user);
    if (!refusal) return null;
    return {
      message: refusal.message ?? GOOGLE_LINK_FAILED_MESSAGE,
      reason: refusal.reason,
    };
  }

  /** A `link` state (with `uid`) that this browser was bound to; else null. */
  private verifyBoundState(
    req: Request,
    res: Response,
    token: unknown,
  ): { n: string; uid: number } | null {
    const state = verifyGoogleSigninState(this.jwt, token);
    if (state?.action !== 'link' || state.uid === undefined) return null;
    try {
      assertLinkStateBoundToBrowser(req, res, 'google', state.r);
    } catch {
      return null;
    }
    return { n: state.n, uid: state.uid };
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
        redirectUri: googleRedirectUri(base, GOOGLE_LINK_CALLBACK_PATH),
      });
      if (!tokens.idToken) return null;
      return readGoogleSigninClaims(
        tokens.idToken,
        client.clientId,
        deriveSigninNonce(n),
      );
    } catch (err) {
      this.logger.warn(
        `google-link exchange failed ${exchangeFailureClass(err)}`,
      );
      return null;
    }
  }

  /**
   * Insert the identity. Locks the users row (same lock as
   * `SigninMethodsService.unlinkGoogle`) and pre-checks both unique keys so
   * the insert cannot violate inside the transaction; a race that still
   * collides rolls back whole and maps to the "taken" 409 here.
   */
  async linkIdentity(
    userId: number,
    claims: GoogleSigninClaims,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        if (!(await needsInsert(tx, userId, claims.sub))) return;
        await tx.insert(identities).values({
          userId,
          provider: 'google',
          subject: claims.sub,
          email: claims.email,
          lastUsedAt: new Date(),
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(GOOGLE_SUB_TAKEN_MESSAGE);
      }
      throw err;
    }
  }

  private refuse(base: string, message: string, logReason: string): string {
    this.logger.log(`google-link refused reason=${logReason}`);
    return this.resultUrl(base, message);
  }
}
