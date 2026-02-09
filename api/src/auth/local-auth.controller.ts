import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LocalAuthService } from './local-auth.service';
import { AdminGuard } from './admin.guard';
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

interface AuthenticatedRequest {
  user: {
    id: number;
    username: string;
    isAdmin: boolean;
    impersonatedBy: number | null;
  };
}

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

  /**
   * POST /auth/impersonate/:userId
   * Admin-only. Issue a JWT as the target user for testing/debugging.
   * Returns both the impersonated token and the original admin token.
   */
  @Post('impersonate/:userId')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('userId', ParseIntPipe) userId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.localAuthService.impersonate(req.user, userId);
  }

  /**
   * POST /auth/impersonate/exit
   * Exit impersonation and restore admin session.
   */
  @Post('impersonate/exit')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  exitImpersonation(@Request() req: AuthenticatedRequest) {
    if (!req.user.impersonatedBy) {
      throw new ForbiddenException('Not currently impersonating');
    }

    // Return a message — the frontend handles token swap
    // using the original_token it stored when starting impersonation
    return {
      message: 'Impersonation ended',
      adminUserId: req.user.impersonatedBy,
    };
  }

  /**
   * GET /auth/users
   * Admin-only. List non-admin users for the impersonation dropdown.
   */
  @Get('users')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async listUsers() {
    return this.localAuthService.listNonAdminUsers();
  }
}
