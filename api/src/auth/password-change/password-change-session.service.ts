import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@raid-ledger/contract';
import { TokenBlocklistService } from '../token-blocklist.service';
import {
  RefreshTokenService,
  type IssuedRefreshToken,
} from '../refresh/refresh-token.service';

/** The caller whose session is re-issued after their own password change. */
export interface PasswordChangeCaller {
  id: number;
  username: string;
  role: UserRole;
}

/** A fresh session: the access JWT for the body + the refresh family for `rl_rt`. */
export interface ReissuedSession {
  accessToken: string;
  refresh: IssuedRefreshToken;
}

/**
 * The first whole second strictly after a `blockUser` stamp. `blockUser`
 * stamps `floor(now)` BEFORE it resolves, so `floor(now) + 1` read afterwards
 * is always greater than the stamp, and `isBlocked` (`iat <= stamp`) cannot
 * match a token minted with it. Deterministic: no wait for the clock to tick.
 */
export function firstSecondAfterBlock(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) + 1;
}

/**
 * ROK-1810: a password change ends every existing session. Refresh families
 * are revoked (no more `/auth/refresh`) and the user is blocklisted (every
 * access JWT minted so far gets 401). The caller who changed their own
 * password is then handed a brand-new session instead of being logged out.
 */
@Injectable()
export class PasswordChangeSessionService {
  constructor(
    private readonly refresh: RefreshTokenService,
    private readonly blocklist: TokenBlocklistService,
    private readonly jwt: JwtService,
  ) {}

  /** Revoke every refresh family and access JWT the user holds. */
  async revokeAllSessions(userId: number): Promise<void> {
    await this.refresh.revokeAllForUser(userId);
    await this.blocklist.blockUser(userId);
  }

  /** Revoke everything, then issue the caller a fresh session. */
  async revokeAndReissue(
    caller: PasswordChangeCaller,
    userAgent: string | null,
  ): Promise<ReissuedSession> {
    await this.revokeAllSessions(caller.id);
    const refresh = await this.refresh.issue(caller.id, {
      authMethod: 'local',
      userAgent,
    });
    const accessToken = this.jwt.sign({
      username: caller.username,
      sub: caller.id,
      role: caller.role,
      iat: firstSecondAfterBlock(),
    });
    return { accessToken, refresh };
  }
}
