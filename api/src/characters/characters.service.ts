import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CharacterDto,
  CharacterListResponseDto,
  CreateCharacterInput,
  UpdateCharacterDto,
} from '@raid-ledger/contract';

/**
 * Service for managing player characters (ROK-130).
 * Supports Main/Alt designation with enforced single main per game.
 */
@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Get all characters for a user.
   * @param userId - User ID
   * @param gameId - Optional game ID to filter characters (ROK-131)
   * @returns List of characters sorted by display order
   */
  async findAllForUser(
    userId: number,
    gameId?: string,
  ): Promise<CharacterListResponseDto> {
    const conditions = [eq(schema.characters.userId, userId)];
    if (gameId) {
      conditions.push(eq(schema.characters.gameId, gameId));
    }

    const chars = await this.db
      .select()
      .from(schema.characters)
      .where(and(...conditions))
      .orderBy(asc(schema.characters.displayOrder));

    return {
      data: chars.map(this.mapToDto),
      meta: { total: chars.length },
    };
  }

  /**
   * Get a single character by ID.
   * @param userId - User ID (for ownership check)
   * @param characterId - Character ID
   * @returns Character DTO
   * @throws NotFoundException if not found
   * @throws ForbiddenException if not owned by user
   */
  async findOne(userId: number, characterId: string): Promise<CharacterDto> {
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);

    if (!character) {
      throw new NotFoundException(`Character ${characterId} not found`);
    }

    if (character.userId !== userId) {
      throw new ForbiddenException('You do not own this character');
    }

    return this.mapToDto(character);
  }

  /**
   * Create a new character.
   * @param userId - User ID
   * @param dto - Character creation data
   * @returns Created character
   */
  async create(
    userId: number,
    dto: CreateCharacterInput,
  ): Promise<CharacterDto> {
    // Verify game exists
    const [game] = await this.db
      .select()
      .from(schema.gameRegistry)
      .where(eq(schema.gameRegistry.id, dto.gameId))
      .limit(1);

    if (!game) {
      throw new NotFoundException(`Game ${dto.gameId} not found`);
    }

    // Use transaction for atomic demotion + insert to prevent race conditions
    try {
      return await this.db.transaction(async (tx) => {
        // If setting as main, demote any existing main first
        if (dto.isMain) {
          await tx
            .update(schema.characters)
            .set({ isMain: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.characters.userId, userId),
                eq(schema.characters.gameId, dto.gameId),
                eq(schema.characters.isMain, true),
              ),
            );
        }

        const [character] = await tx
          .insert(schema.characters)
          .values({
            userId,
            gameId: dto.gameId,
            name: dto.name,
            realm: dto.realm ?? null,
            class: dto.class ?? null,
            spec: dto.spec ?? null,
            role: dto.role ?? null,
            isMain: dto.isMain ?? false,
            itemLevel: dto.itemLevel ?? null,
            avatarUrl: dto.avatarUrl ?? null,
          })
          .returning();

        this.logger.log(
          `User ${userId} created character ${character.id} (${character.name})`,
        );
        return this.mapToDto(character);
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('unique_user_game_character')
      ) {
        throw new ConflictException(
          `Character ${dto.name} already exists for this game/realm`,
        );
      }
      throw error;
    }
  }

  /**
   * Update a character.
   * @param userId - User ID (for ownership check)
   * @param characterId - Character ID
   * @param dto - Update data
   * @returns Updated character
   */
  async update(
    userId: number,
    characterId: string,
    dto: UpdateCharacterDto,
  ): Promise<CharacterDto> {
    // Verify ownership
    await this.findOne(userId, characterId);

    const [updated] = await this.db
      .update(schema.characters)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(schema.characters.id, characterId))
      .returning();

    this.logger.log(`User ${userId} updated character ${characterId}`);
    return this.mapToDto(updated);
  }

  /**
   * Delete a character.
   * @param userId - User ID (for ownership check)
   * @param characterId - Character ID
   */
  async delete(userId: number, characterId: string): Promise<void> {
    // Verify ownership
    await this.findOne(userId, characterId);

    await this.db
      .delete(schema.characters)
      .where(eq(schema.characters.id, characterId));

    this.logger.log(`User ${userId} deleted character ${characterId}`);
  }

  /**
   * Set a character as the main for its game.
   * Automatically demotes any existing main for the same game.
   * @param userId - User ID (for ownership check)
   * @param characterId - Character to promote
   * @returns Updated character
   */
  async setMain(userId: number, characterId: string): Promise<CharacterDto> {
    // Get the character and verify ownership
    const character = await this.findOne(userId, characterId);

    // Use transaction for atomic main swap
    return this.db.transaction(async (tx) => {
      // Demote current main for this game (if any)
      await tx
        .update(schema.characters)
        .set({ isMain: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.characters.userId, userId),
            eq(schema.characters.gameId, character.gameId),
            eq(schema.characters.isMain, true),
          ),
        );

      // Promote new main
      const [updated] = await tx
        .update(schema.characters)
        .set({ isMain: true, updatedAt: new Date() })
        .where(eq(schema.characters.id, characterId))
        .returning();

      this.logger.log(
        `User ${userId} set character ${characterId} as main for game ${character.gameId}`,
      );
      return this.mapToDto(updated);
    });
  }

  /**
   * Demote existing main character for a game.
   * Called before creating/setting a new main.
   */
  private async demoteExistingMain(
    userId: number,
    gameId: string,
  ): Promise<void> {
    await this.db
      .update(schema.characters)
      .set({ isMain: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.characters.userId, userId),
          eq(schema.characters.gameId, gameId),
          eq(schema.characters.isMain, true),
        ),
      );
  }

  /**
   * Map database row to DTO.
   */
  private mapToDto(row: typeof schema.characters.$inferSelect): CharacterDto {
    return {
      id: row.id,
      userId: row.userId,
      gameId: row.gameId,
      name: row.name,
      realm: row.realm,
      class: row.class,
      spec: row.spec,
      role: row.role as CharacterDto['role'],
      isMain: row.isMain,
      itemLevel: row.itemLevel,
      externalId: row.externalId,
      avatarUrl: row.avatarUrl,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
