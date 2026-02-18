import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  GameRegistryDto,
  GameRegistryListResponseDto,
  GameRegistryDetailResponseDto,
  EventTypesResponseDto,
  EventTypeDto,
} from '@raid-ledger/contract';

@Injectable()
export class GameRegistryService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Get all registered games.
   */
  async findAll(): Promise<GameRegistryListResponseDto> {
    const games = await this.db
      .select()
      .from(schema.gameRegistry)
      .orderBy(schema.gameRegistry.name);

    return {
      data: games.map((g) => this.mapGameToDto(g)),
      meta: {
        total: games.length,
      },
    };
  }

  /**
   * Get a single game with its event types.
   */
  async findOne(id: string): Promise<GameRegistryDetailResponseDto> {
    const games = await this.db
      .select()
      .from(schema.gameRegistry)
      .where(eq(schema.gameRegistry.id, id))
      .limit(1);

    if (games.length === 0) {
      throw new NotFoundException(`Game with ID ${id} not found`);
    }

    const eventTypes = await this.db
      .select()
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.gameId, id))
      .orderBy(schema.eventTypes.name);

    const game = games[0];

    return {
      ...this.mapGameToDto(game),
      eventTypes: eventTypes.map((et) => this.mapEventTypeToDto(et)),
    };
  }

  /**
   * Get event types for a specific game.
   */
  async getEventTypes(gameId: string): Promise<EventTypesResponseDto> {
    // Verify game exists
    const games = await this.db
      .select()
      .from(schema.gameRegistry)
      .where(eq(schema.gameRegistry.id, gameId))
      .limit(1);

    if (games.length === 0) {
      throw new NotFoundException(`Game with ID ${gameId} not found`);
    }

    const game = games[0];

    const eventTypes = await this.db
      .select()
      .from(schema.eventTypes)
      .where(eq(schema.eventTypes.gameId, gameId))
      .orderBy(schema.eventTypes.name);

    return {
      data: eventTypes.map((et) => this.mapEventTypeToDto(et)),
      meta: {
        total: eventTypes.length,
        gameId: game.id,
        gameName: game.name,
      },
    };
  }

  /**
   * Map database game to DTO.
   */
  private mapGameToDto(
    game: typeof schema.gameRegistry.$inferSelect,
  ): GameRegistryDto {
    return {
      id: game.id,
      slug: game.slug,
      name: game.name,
      shortName: game.shortName,
      iconUrl: game.iconUrl,
      colorHex: game.colorHex,
      hasRoles: game.hasRoles,
      hasSpecs: game.hasSpecs,
      maxCharactersPerUser: game.maxCharactersPerUser,
      createdAt: game.createdAt.toISOString(),
    };
  }

  /**
   * Map database event type to DTO.
   */
  private mapEventTypeToDto(
    eventType: typeof schema.eventTypes.$inferSelect,
  ): EventTypeDto {
    return {
      id: eventType.id,
      gameId: eventType.gameId,
      slug: eventType.slug,
      name: eventType.name,
      defaultPlayerCap: eventType.defaultPlayerCap,
      defaultDurationMinutes: eventType.defaultDurationMinutes,
      requiresComposition: eventType.requiresComposition,
      createdAt: eventType.createdAt.toISOString(),
    };
  }
}
