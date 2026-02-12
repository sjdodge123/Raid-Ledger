import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import type { UserRole } from '@raid-ledger/contract';

@Injectable()
export class AuthService {
  constructor(
    @Inject(UsersService) private usersService: UsersService,
    @Inject(JwtService) private jwtService: JwtService,
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
      return relinked;
    }

    const user = await this.usersService.createOrUpdate({
      discordId,
      username,
      avatar: avatar || undefined,
    });
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
