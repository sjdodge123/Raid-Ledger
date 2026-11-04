import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  SimilarPlayersResponseDto,
  TasteProfileResponseDto,
} from '@raid-ledger/contract';
import type { AuthenticatedRequest } from '../auth/types';
import { TasteProfileService } from './taste-profile.service';

@Controller('users/:id')
@UseGuards(AuthGuard('jwt'))
export class TasteProfileController {
  constructor(private readonly service: TasteProfileService) {}

  @Get('taste-profile')
  async getTasteProfile(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ): Promise<TasteProfileResponseDto> {
    await this.assertUserVisible(id, req);
    const result = await this.service.getTasteProfile(id);
    if (!result) throw new NotFoundException('User not found');
    return result;
  }

  @Get('similar-players')
  async getSimilarPlayers(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Query('limit') limitRaw?: string,
  ): Promise<SimilarPlayersResponseDto> {
    await this.assertUserVisible(id, req);
    const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw), 50)) : 10;
    const similar = await this.service.findSimilarPlayers(id, limit);
    return { similar };
  }

  /**
   * ROK-1260: a deactivated target 404s for non-admin viewers, mirroring
   * `UsersController.assertUserVisible`. Admins keep audit access.
   */
  private async assertUserVisible(
    targetUserId: number,
    req: AuthenticatedRequest,
  ): Promise<void> {
    if (req.user.role === 'admin') return;
    if (await this.service.isUserDeactivated(targetUserId)) {
      throw new NotFoundException('User not found');
    }
  }
}
