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

// Accept either 'email' or 'username' field for backwards compatibility
const LocalLoginSchema = z
  .object({
    email: z.string().regex(emailRegex, 'Invalid email format').optional(),
    username: z
      .string()
      .regex(emailRegex, 'Invalid username format')
      .optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((data) => data.email || data.username, {
    message: 'Email or username is required',
  });

type LocalLoginDto = z.infer<typeof LocalLoginSchema>;

@Controller('auth')
export class LocalAuthController {
  constructor(private localAuthService: LocalAuthService) {}

  /**
   * POST /auth/local
   * Authenticate with email/password or username/password credentials.
   * Accepts either 'email' or 'username' field for backwards compatibility.
   */
  @Post('local')
  @HttpCode(HttpStatus.OK)
  async localLogin(@Body() body: LocalLoginDto) {
    // Validate request body
    const result = LocalLoginSchema.safeParse(body);
    if (!result.success) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Use email if provided, otherwise username (both are email format)
    const email = result.data.email || result.data.username!;
    const { password } = result.data;

    // Validate credentials and get user
    const user = await this.localAuthService.validateCredentials(
      email,
      password,
    );

    // Generate JWT
    return this.localAuthService.login(user);
  }
}
