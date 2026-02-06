import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  NotificationService,
  type NotificationDto,
  type NotificationPreferencesDto,
  type UpdatePreferencesInput,
} from './notification.service';

interface AuthenticatedRequest {
  user: { id: number; discordId?: string };
}

/**
 * Controller for user notifications (ROK-197).
 * All endpoints are scoped to the authenticated user.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Get all notifications for the current user (paginated).
   * GET /notifications?limit=20&offset=0
   */
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getNotifications(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<NotificationDto[]> {
    // Validate and cap pagination params to prevent DOS
    const parsedLimit = Math.min(
      Math.max(limit ? parseInt(limit, 10) : 20, 1),
      100,
    ); // Cap at 100
    const parsedOffset = Math.max(offset ? parseInt(offset, 10) : 0, 0); // No negative offsets

    return this.notificationService.getAll(
      req.user.id,
      parsedLimit,
      parsedOffset,
    );
  }

  /**
   * Get unread notification count.
   * GET /notifications/unread/count
   */
  @Get('unread/count')
  @UseGuards(AuthGuard('jwt'))
  async getUnreadCount(
    @Request() req: AuthenticatedRequest,
  ): Promise<{ count: number }> {
    const count = await this.notificationService.getUnreadCount(req.user.id);
    return { count };
  }

  /**
   * Mark a single notification as read.
   * POST /notifications/:id/read
   */
  @Post(':id/read')
  @UseGuards(AuthGuard('jwt'))
  async markRead(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.notificationService.markRead(req.user.id, id);
    return { success: true };
  }

  /**
   * Mark all notifications as read.
   * POST /notifications/read-all
   */
  @Post('read-all')
  @UseGuards(AuthGuard('jwt'))
  async markAllRead(
    @Request() req: AuthenticatedRequest,
  ): Promise<{ success: boolean }> {
    await this.notificationService.markAllRead(req.user.id);
    return { success: true };
  }

  /**
   * Get notification preferences for the current user.
   * GET /notifications/preferences
   */
  @Get('preferences')
  @UseGuards(AuthGuard('jwt'))
  async getPreferences(
    @Request() req: AuthenticatedRequest,
  ): Promise<NotificationPreferencesDto> {
    return this.notificationService.getPreferences(req.user.id);
  }

  /**
   * Update notification preferences.
   * PATCH /notifications/preferences
   */
  @Patch('preferences')
  @UseGuards(AuthGuard('jwt'))
  async updatePreferences(
    @Request() req: AuthenticatedRequest,
    @Body() body: UpdatePreferencesInput,
  ): Promise<NotificationPreferencesDto> {
    return this.notificationService.updatePreferences(req.user.id, body);
  }
}
