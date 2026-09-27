import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { signPurposeJwt, verifyPurposeJwt } from './purpose-jwt.helpers';
import { consumeTokenOnce } from './single-use-token.helpers';

/** Link-start nonce lifetime (operator ruling OQ2, 2026-09-27). */
export const LINK_NONCE_TTL_SECONDS = 120;

export type LinkProvider = 'discord' | 'steam';

/** What a consumed nonce proves: who started the link, and Steam's returnTo. */
export interface LinkNonceClaims {
  userId: number;
  returnTo?: string;
}

interface LinkNoncePayload {
  sub?: unknown;
  returnTo?: unknown;
}

/**
 * ROK-1630: replaces `?token=<access JWT>` on GET /auth/{provider}/link with a
 * signed, provider-bound (purpose secret `link-nonce:<provider>`), single-use
 * nonce. Minted by POST /auth/{provider}/link/start behind the JWT guard.
 */
@Injectable()
export class LinkNonceService {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  mint(
    provider: LinkProvider,
    userId: number,
    returnTo?: string,
  ): { nonce: string; expiresIn: number } {
    const payload = returnTo ? { sub: userId, returnTo } : { sub: userId };
    const nonce = signPurposeJwt(
      this.jwtService,
      `link-nonce:${provider}`,
      payload,
      LINK_NONCE_TTL_SECONDS,
    );
    return { nonce, expiresIn: LINK_NONCE_TTL_SECONDS };
  }

  /**
   * Verify and consume. Returns null on EVERY miss (missing, garbage,
   * expired, wrong provider, replay) so the GET hop can answer them all with
   * the same redirect (D7). Only a verified nonce is ever written.
   */
  async consume(
    provider: LinkProvider,
    nonce: string | undefined,
  ): Promise<LinkNonceClaims | null> {
    const payload = this.verify(provider, nonce);
    if (!payload || !nonce) return null;
    if (!(await consumeTokenOnce(this.db, nonce))) return null;
    return payload;
  }

  private verify(
    provider: LinkProvider,
    nonce: string | undefined,
  ): LinkNonceClaims | null {
    if (!nonce) return null;
    let payload: LinkNoncePayload;
    try {
      payload = verifyPurposeJwt(
        this.jwtService,
        `link-nonce:${provider}`,
        nonce,
      );
    } catch {
      return null;
    }
    if (typeof payload.sub !== 'number') return null;
    const returnTo =
      typeof payload.returnTo === 'string' ? payload.returnTo : undefined;
    return returnTo
      ? { userId: payload.sub, returnTo }
      : { userId: payload.sub };
  }
}
