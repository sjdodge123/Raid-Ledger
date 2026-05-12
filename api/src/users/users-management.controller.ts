/**
 * Admin-only management endpoints for the User entity.
 * Extracted from users.controller.ts (ROK-1260) for file-size compliance.
 *
 * All routes are mounted at `@Controller('users')` and pre-guarded with
 * `AuthGuard('jwt') + AdminGuard` at the class level — every endpoint in
 * this file requires an admin caller.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { OperatorGuard } from '../auth/operator.guard';
import { AdminGuard } from '../auth/admin.guard';
import {
  UpdateUserRoleSchema,
  type ReactivateUserResponseDto,
  type UserManagementListResponseDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import {
  buildPaginatedMeta,
  parsePagination,
} from './users-controller.helpers';
import { mapManagementRow } from './users-management.helpers';

@Controller('users')
export class UsersManagementController {
  constructor(
    private readonly usersService: UsersService,
    private readonly avatarService: AvatarService,
  ) {}

  /** List all users with role information (admin-only, ROK-272). */
  @Get('management')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async listUsersForManagement(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
  ): Promise<UserManagementListResponseDto> {
    const { page, limit } = parsePagination(pageStr, limitStr);
    const result = await this.usersService.findAllWithRoles(
      page,
      limit,
      search || undefined,
    );
    return {
      data: result.data.map(mapManagementRow),
      meta: buildPaginatedMeta(result.total, page, limit),
    };
  }

  /** Update a user's role (admin-only, ROK-272). */
  @Patch(':id/role')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const dto = UpdateUserRoleSchema.parse(body);
    if (id === req.user.id)
      throw new ForbiddenException('Cannot change your own role');
    const targetUser = await this.usersService.findById(id);
    if (!targetUser) throw new NotFoundException('User not found');
    if (targetUser.role === 'admin')
      throw new ForbiddenException('Cannot modify admin role via API');
    const updated = await this.usersService.setRole(id, dto.role);
    return {
      data: { id: updated.id, username: updated.username, role: updated.role },
    };
  }

  /** Reactivate a deactivated user (admin-only, ROK-1260). */
  @Post(':id/reactivate')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  async reactivateUser(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ReactivateUserResponseDto> {
    const targetUser = await this.usersService.findById(id);
    if (!targetUser) throw new NotFoundException('User not found');
    const updated = await this.usersService.reactivateUser(id);
    return { data: mapManagementRow(updated) };
  }

  /** Admin-remove a user (ROK-405). */
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @HttpCode(204)
  async adminRemoveUser(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ) {
    if (id === req.user.id)
      throw new BadRequestException('Cannot delete yourself');
    const targetUser = await this.usersService.findById(id);
    if (!targetUser) throw new NotFoundException('User not found');
    if (targetUser.role === 'admin')
      throw new ForbiddenException('Cannot delete another admin');
    if (targetUser.customAvatarUrl)
      await this.avatarService.delete(targetUser.customAvatarUrl);
    await this.usersService.deleteUser(id, req.user.id);
  }

  /** Operator+: remove any user's custom avatar (ROK-220 content moderation). */
  @Delete(':id/avatar')
  @UseGuards(AuthGuard('jwt'), OperatorGuard)
  @HttpCode(204)
  async adminDeleteAvatar(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (user.customAvatarUrl) {
      await this.avatarService.delete(user.customAvatarUrl);
      await this.usersService.setCustomAvatar(id, null);
    }
  }
}
