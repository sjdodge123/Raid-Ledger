import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { GameTasteProfileResponseDto } from '@raid-ledger/contract';
import { GameTasteService } from './game-taste.service';

/**
 * Public-authenticated route for the game-detail page radar chart (ROK-1082).
 * Returns the persisted vector + dimensions + confidence. Derivation stays
 * on the admin `GET /games/:id/taste-vector` endpoint.
 */
@Controller('games')
@UseGuards(AuthGuard('jwt'))
export class GameTastePublicController {
  constructor(private readonly service: GameTasteService) {}

  @Get(':id/taste-profile')
  async getTasteProfile(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameTasteProfileResponseDto> {
    const result = await this.service.getTasteProfile(id);
    if (!result) throw new NotFoundException('Game taste profile not found');
    return result;
  }
}
