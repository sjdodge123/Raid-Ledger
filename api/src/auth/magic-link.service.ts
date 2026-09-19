import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

/**
 * Generate short-lived authenticated links for Discord -> web transitions.
 * Used by slash commands to provide pre-authenticated links to the web app.
 *
 * The frontend consumes `?token=JWT` at module load time (App.tsx) to
 * auto-authenticate unauthenticated users arriving via magic links (ROK-657).
 */
@Injectable()
export class MagicLinkService {
  constructor(
    @Inject(JwtService) private jwtService: JwtService,
    @Inject(UsersService) private usersService: UsersService,
  ) {}

  /**
   * Generate a magic link URL that pre-authenticates the user.
   * The token is short-lived (15 minutes) and scoped to a specific path.
   *
   * @param userId - The user ID to authenticate
   * @param path - The target path in the web app (e.g., "/events/42/edit")
   * @param clientUrl - The base URL of the web client
   * @returns The magic link URL or null if user not found
   */
  async generateLink(
    userId: number,
    path: string,
    clientUrl: string,
  ): Promise<string | null> {
    const user = await this.usersService.findById(userId);
    if (!user) return null;

    const token = this.jwtService.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
        magicLink: true,
      },
      { expiresIn: '15m' },
    );

    const url = new URL(path, clientUrl);
    // ROK-1366: the token rides in the URL *fragment*, not the query string.
    // A fragment is never sent to a server, so it cannot land in access logs,
    // reverse-proxy logs, a Referer header on any outbound subresource, or a
    // link-tracker's redirect chain — all of which see `?token=`. The client
    // still accepts the legacy `?token=` form so links already in Discord
    // keep working; see web/src/lib/magic-link.ts.
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  }
}
