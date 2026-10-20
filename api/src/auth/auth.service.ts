import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { UsersService } from '../users/users.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  assertNotBanned,
  assertKickCooldownOrClear,
} from './auth-status.helpers';
import type { UserRole } from '@raid-ledger/contract';
import { promoteFirstDiscordLogin } from './fleet-first-login-admin.helpers';
import { signAccessToken } from './access-token-mint.helpers';
import { readTokenVersion } from './token-version.helpers';

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
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async validateDiscordUser(
    discordId: string,
    username: string,
    avatar: string | null = null,
  ) {
    const unlinked =
      await this.usersService.findByDiscordIdIncludingUnlinked(discordId);
    // ROK-313: block banned users; enforce (or auto-clear) the kick cooldown
    // before any re-link / create-or-update on an existing account.
    if (unlinked) {
      assertNotBanned(unlinked);
      await assertKickCooldownOrClear(this.db, unlinked);
    }
    if (unlinked && unlinked.discordId?.startsWith('unlinked:')) {
      const relinked = await this.relinkUnlinkedAccount(
        unlinked.id,
        discordId,
        username,
        avatar,
      );
      return relinked
        ? promoteFirstDiscordLogin(this.db, relinked, discordId)
        : relinked;
    }

    const user = await this.usersService.createOrUpdate({
      discordId,
      username,
      avatar: avatar || null,
    });
    this.emitDiscordLogin(user.id, discordId);
    // ROK-1537: fleet-only first-login admin; a no-op outside a fleet env.
    return promoteFirstDiscordLogin(this.db, user, discordId);
  }

  private async relinkUnlinkedAccount(
    userId: number,
    discordId: string,
    username: string,
    avatar: string | null = null,
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

  /** ROK-1823: signs the user's CURRENT token version as `tv`. */
  async login(user: { id: number; username: string; role: UserRole }) {
    const tv = await readTokenVersion(this.db, user.id);
    const access_token = signAccessToken(
      { jwt: this.jwtService },
      { username: user.username, sub: user.id, role: user.role, tv },
    );
    return { access_token };
  }
}
