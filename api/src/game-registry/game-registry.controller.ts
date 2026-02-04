import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { GameRegistryService } from './game-registry.service';
import {
  GameRegistryListResponseDto,
  GameRegistryDetailResponseDto,
  EventTypesResponseDto,
} from '@raid-ledger/contract';

/**
 * Controller for game registry endpoints.
 * Provides read-only access to supported games and their event types.
 */
@Controller('game-registry')
export class GameRegistryController {
  constructor(private readonly gameRegistryService: GameRegistryService) {}

  /**
   * Get all registered games.
   * Public endpoint.
   */
  @Get()
  async findAll(): Promise<GameRegistryListResponseDto> {
    return this.gameRegistryService.findAll();
  }

  /**
   * Get a single game with its event types.
   * Public endpoint.
   */
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GameRegistryDetailResponseDto> {
    return this.gameRegistryService.findOne(id);
  }

  /**
   * Get event types for a specific game.
   * Public endpoint.
   */
  @Get(':id/event-types')
  async getEventTypes(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventTypesResponseDto> {
    return this.gameRegistryService.getEventTypes(id);
  }
}
