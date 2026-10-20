import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@raid-ledger/contract';
import { TokenBlocklistService } from '../token-blocklist.service';
import { signAccessToken } from '../access-token-mint.helpers';
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
 * ROK-1810: a password change ends every existing session. Refresh families
 * are revoked (no more `/auth/refresh`) and the user is blocklisted (every
 * access JWT minted so far gets 401). The caller who changed their own
 * password is then handed a brand-new session instead of being logged out.
 */
@Injectable()
export class PasswordChangeSessionService {
  private readonly logger = new Logger(PasswordChangeSessionService.name);

  constructor(
    private readonly refresh: RefreshTokenService,
    private readonly blocklist: TokenBlocklistService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Revoke every refresh family and access JWT the user holds; returns the
   * bumped token version for `issueSession`. Run it BEFORE the hash update:
   * a failure after it leaves the old password with no live sessions, never
   * the new password live beside old ones. ROK-1823: the refresh revoke and
   * the version bump share one transaction, so a failure there throws and
   * leaves every session intact. The legacy blocklist write still follows
   * (removed in a later lane); its swallowed Redis error is logged.
   */
  async revokeAllSessions(userId: number): Promise<number> {
    const version = await this.refresh.revokeAllAndBump(userId);
    const blocked = await this.blocklist.blockUser(userId);
    if (!blocked) {
      this.logger.error(
        `Password change for user ${userId}: access-token blocklist write failed; the token-version bump already revoked existing access JWTs`,
      );
    }
    return version;
  }

  /**
   * Issue the caller a fresh session after `revokeAllSessions`, signed with
   * the version it returned (ROK-1823). `authMethod`
   * is `local` even for a Discord/magic-link session: the caller just proved
   * the local password.
   */
  async issueSession(
    caller: PasswordChangeCaller,
    userAgent: string | null,
    tokenVersion: number,
  ): Promise<ReissuedSession> {
    const refresh = await this.refresh.issue(caller.id, {
      authMethod: 'local',
      userAgent,
    });
    const accessToken = await signAccessToken(
      { jwt: this.jwt, blocklist: this.blocklist },
      {
        username: caller.username,
        sub: caller.id,
        role: caller.role,
        tv: tokenVersion,
      },
    );
    return { accessToken, refresh };
  }
}
