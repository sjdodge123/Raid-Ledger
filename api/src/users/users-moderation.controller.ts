/**
 * Admin-only moderation endpoints (ROK-313 §3e): kick / unkick / ban / unban and
 * the per-user audit history. Mounted at `@Controller('users')`; every route is
 * class-guarded with `AuthGuard('jwt') + AdminGuard` (mirrors
 * `users-management.controller.ts`). Admin-protection guards (not-self, not
 * another admin) run before any state change.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  BanUserSchema,
  KickUserSchema,
  type AdminActionsListResponseDto,
  type ModerationActionResponseDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { UsersService } from './users.service';
import { parsePagination } from './users-controller.helpers';

@Controller('users')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class UsersModerationController {
  constructor(private readonly usersService: UsersService) {}

  /** Shared admin-protection guard: never self, never another admin. Returns the
   * target row so callers can apply action-specific checks. */
  private async requireModeratableTarget(
    id: number,
    req: AuthenticatedRequest,
  ): Promise<{ role: string; bannedAt: Date | null }> {
    if (id === req.user.id)
      throw new BadRequestException('You cannot moderate your own account');
    const target = await this.usersService.findById(id);
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'admin')
      throw new ForbiddenException('Cannot moderate an admin');
    return target;
  }

  @Post(':id/kick')
  async kickUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ModerationActionResponseDto> {
    const dto = KickUserSchema.parse(body);
    const target = await this.requireModeratableTarget(id, req);
    if (target.bannedAt)
      throw new BadRequestException('User is already banned');
    return this.usersService.kickUser(req.user.id, id, dto);
  }

  @Post(':id/unkick')
  async unkickUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<ModerationActionResponseDto> {
    await this.requireModeratableTarget(id, req);
    return this.usersService.unkickUser(req.user.id, id);
  }

  @Post(':id/ban')
  async banUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ModerationActionResponseDto> {
    const dto = BanUserSchema.parse(body);
    const target = await this.requireModeratableTarget(id, req);
    if (target.bannedAt)
      throw new BadRequestException('User is already banned');
    return this.usersService.banUser(req.user.id, id, dto);
  }

  @Post(':id/unban')
  async unbanUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<ModerationActionResponseDto> {
    await this.requireModeratableTarget(id, req);
    return this.usersService.unbanUser(req.user.id, id);
  }

  @Get(':id/admin-actions')
  async getAdminActions(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ): Promise<AdminActionsListResponseDto> {
    const { page, limit } = parsePagination(pageStr, limitStr);
    return this.usersService.getAdminActionsForUser(id, page, limit);
  }
}
