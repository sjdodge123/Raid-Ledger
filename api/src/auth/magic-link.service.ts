import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

/**
 * Generate short-lived authenticated links for Discord -> web transitions.
 * Used by slash commands to provide pre-authenticated links to the web app.
 *
 * TODO(ROK-373): The `?token=JWT` param appended to magic link URLs is not
 * consumed by the frontend. Already-authenticated users navigate fine, but
 * unauthenticated users get no auto-auth benefit. Follow-up: implement
 * token consumption on the frontend to auto-authenticate via the magic link.
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
    url.searchParams.set('token', token);
    return url.toString();
  }
}
