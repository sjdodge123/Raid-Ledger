import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

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
    const user = await this.usersService.createOrUpdate({
      discordId,
      username,
      avatar: avatar || undefined,
    });
    return user;
  }

  async login(user: any) {
    const payload = {
      username: user.username,
      sub: user.id,
      isAdmin: user.isAdmin,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
