import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import type { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: { id: number; username: string; isAdmin: boolean };
}

@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminController {
  @Get('check')
  checkAccess(@Req() req: AuthenticatedRequest) {
    return {
      message: 'Admin access granted',
      user: req.user,
    };
  }
}
