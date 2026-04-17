import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  SimilarPlayersResponseDto,
  TasteProfileResponseDto,
} from '@raid-ledger/contract';
import { TasteProfileService } from './taste-profile.service';

@Controller('users/:id')
@UseGuards(AuthGuard('jwt'))
export class TasteProfileController {
  constructor(private readonly service: TasteProfileService) {}

  @Get('taste-profile')
  async getTasteProfile(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TasteProfileResponseDto> {
    const result = await this.service.getTasteProfile(id);
    if (!result) throw new NotFoundException('User not found');
    return result;
  }

  @Get('similar-players')
  async getSimilarPlayers(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limitRaw?: string,
  ): Promise<SimilarPlayersResponseDto> {
    const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw), 50)) : 10;
    const similar = await this.service.findSimilarPlayers(id, limit);
    return { similar };
  }
}
