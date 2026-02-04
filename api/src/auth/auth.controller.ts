import { Controller, Get, Req, UseGuards, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';

interface RequestWithUser {
  user: any;
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Get('discord')
  @UseGuards(AuthGuard('discord'))
  async discordLogin() {
    // Initiates the Discord OAuth flow
  }

  @Get('discord/callback')
  @UseGuards(AuthGuard('discord'))
  async discordLoginCallback(
    @Req() req: RequestWithUser,
    @Res() res: Response,
  ) {
    // User is validated and attached to req.user by DiscordStrategy
    const { access_token } = await this.authService.login(req.user);

    // Redirect to frontend with token
    const clientUrl = this.configService.get<string>('CLIENT_URL');
    // Using query param for simplicity in MVP. Secure httpOnly cookie is better for prod.
    res.redirect(`${clientUrl}/auth/success?token=${access_token}`);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  getProfile(@Req() req: RequestWithUser) {
    return req.user;
  }
}
