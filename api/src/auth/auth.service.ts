import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import type { UserRole } from '@raid-ledger/contract';

/** Event name emitted after Discord OAuth login/link (ROK-292). */
export const AUTH_EVENTS = {
  DISCORD_LOGIN: 'auth.discord-login',
} as const;

/** Payload for auth.discord-login event. */
export interface DiscordLoginPayload {
  userId: number;
  discordId: string;
  /** ROK-409: Invite code from PUG invite flow (for anonymous slot matching) */
  inviteCode?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(UsersService) private usersService: UsersService,
    @Inject(JwtService) private jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async validateDiscordUser(
    discordId: string,
    username: string,
    avatar?: string,
  ) {
    // Check for previously unlinked account first
    const unlinked =
      await this.usersService.findByDiscordIdIncludingUnlinked(discordId);

    if (unlinked && unlinked.discordId?.startsWith('unlinked:')) {
      // Re-link the previously unlinked account
      const relinked = await this.usersService.relinkDiscord(
        unlinked.id,
        username,
        avatar,
      );

      if (relinked) {
        // Emit event for PUG slot claiming (ROK-292)
        this.eventEmitter.emit(AUTH_EVENTS.DISCORD_LOGIN, {
          userId: relinked.id,
          discordId,
        } satisfies DiscordLoginPayload);
      }

      return relinked;
    }

    const user = await this.usersService.createOrUpdate({
      discordId,
      username,
      avatar: avatar || undefined,
    });

    // Emit event for PUG slot claiming (ROK-292)
    this.eventEmitter.emit(AUTH_EVENTS.DISCORD_LOGIN, {
      userId: user.id,
      discordId,
    } satisfies DiscordLoginPayload);

    return user;
  }

  login(user: { id: number; username: string; role: UserRole }) {
    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
