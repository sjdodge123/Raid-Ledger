/**
 * ROK-2371: unlinking a sign-in method, behind the last-method guard
 * (spec §3). `DELETE /users/me/discord` moved here from users-me.controller
 * so both unlinks share one guard.
 */
import {
  Controller,
  Delete,
  HttpCode,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequest } from '../auth/types';
import { SigninMethodsService } from './signin-methods.service';

@Controller('users')
export class UsersSigninMethodsController {
  constructor(private readonly signinMethods: SigninMethodsService) {}

  /** Unlink Discord (→ `unlinked:<id>`); 409 if it is the last method. */
  @Delete('me/discord')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async unlinkDiscord(@Request() req: AuthenticatedRequest): Promise<void> {
    await this.signinMethods.unlinkDiscord(req.user.id);
  }

  /** Unlink the Google identity; 409 if it is the last method. */
  @Delete('me/identities/google')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(204)
  async unlinkGoogle(@Request() req: AuthenticatedRequest): Promise<void> {
    await this.signinMethods.unlinkGoogle(req.user.id);
  }
}
