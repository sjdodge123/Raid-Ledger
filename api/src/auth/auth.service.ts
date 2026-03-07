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
    const unlinked =
      await this.usersService.findByDiscordIdIncludingUnlinked(discordId);
    if (unlinked && unlinked.discordId?.startsWith('unlinked:')) {
      return this.relinkUnlinkedAccount(
        unlinked.id,
        discordId,
        username,
        avatar,
      );
    }

    const user = await this.usersService.createOrUpdate({
      discordId,
      username,
      avatar: avatar || undefined,
    });
    this.emitDiscordLogin(user.id, discordId);
    return user;
  }

  private async relinkUnlinkedAccount(
    userId: number,
    discordId: string,
    username: string,
    avatar?: string,
  ) {
    const relinked = await this.usersService.relinkDiscord(
      userId,
      username,
      avatar,
    );
    if (relinked) this.emitDiscordLogin(relinked.id, discordId);
    return relinked;
  }

  private emitDiscordLogin(userId: number, discordId: string): void {
    this.eventEmitter.emit(AUTH_EVENTS.DISCORD_LOGIN, {
      userId,
      discordId,
    } satisfies DiscordLoginPayload);
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
