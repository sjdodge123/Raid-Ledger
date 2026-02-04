import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { LocalAuthService } from './local-auth.service';
import { z } from 'zod';

// Email regex that accepts local emails (admin@local) and standard emails
const emailRegex = /^[^\s@]+@[^\s@]+$/;

const LocalLoginSchema = z.object({
  email: z.string().regex(emailRegex, 'Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

type LocalLoginDto = z.infer<typeof LocalLoginSchema>;

@Controller('auth')
export class LocalAuthController {
  constructor(private localAuthService: LocalAuthService) {}

  /**
   * POST /auth/local
   * Authenticate with email/password credentials
   */
  @Post('local')
  @HttpCode(HttpStatus.OK)
  async localLogin(@Body() body: LocalLoginDto) {
    // Validate request body
    const result = LocalLoginSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { email, password } = result.data;

    // Validate credentials and get user
    const user = await this.localAuthService.validateCredentials(
      email,
      password,
    );

    // Generate JWT
    return this.localAuthService.login(user);
  }
}
