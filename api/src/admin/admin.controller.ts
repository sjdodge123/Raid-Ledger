import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminController {
  @Get('check')
  checkAccess(@Req() req: any) {
    return {
      message: 'Admin access granted',
      user: req.user,
    };
  }
}
