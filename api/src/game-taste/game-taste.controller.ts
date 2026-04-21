import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  SimilarGamesRequestSchema,
  type GameTasteVectorResponseDto,
  type SimilarGamesResponseDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { GameTasteService } from './game-taste.service';

/**
 * Admin-only routes for the game taste vector pipeline (ROK-1082).
 *
 * - `GET /games/:id/taste-vector` — full vector + per-axis derivation
 * - `POST /games/similar` — resolve one of {userId, userIds, gameId} to a
 *   target vector and return the closest games.
 */
@Controller('games')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class GameTasteController {
  constructor(private readonly service: GameTasteService) {}

  @Get(':id/taste-vector')
  async getTasteVector(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GameTasteVectorResponseDto> {
    const result = await this.service.getVectorWithDerivation(id);
    if (!result) throw new NotFoundException('Game taste vector not found');
    return result;
  }

  @Post('similar')
  async findSimilar(
    @Body() body: unknown,
  ): Promise<SimilarGamesResponseDto> {
    const parsed = SimilarGamesRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const similar = await this.service.findSimilar(parsed.data);
    return { similar };
  }
}
