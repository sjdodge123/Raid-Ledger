import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { eq, and, asc, inArray, isNotNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CharacterDto,
  CharacterListResponseDto,
  CreateCharacterInput,
  UpdateCharacterDto,
  ImportWowCharacterDto,
  RefreshCharacterDto,
} from '@raid-ledger/contract';
import { BlizzardService } from '../blizzard/blizzard.service';

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
    private readonly blizzardService: BlizzardService,
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
      data: chars.map((row) => this.mapToDto(row)),
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
      if (this.isUniqueViolation(error, 'unique_user_game_character')) {
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
   * Import a WoW character from the Blizzard Armory API (ROK-234).
   */
  async importFromBlizzard(
    userId: number,
    dto: ImportWowCharacterDto,
  ): Promise<CharacterDto> {
    // Fetch character data from Blizzard (variant-aware namespace)
    const profile = await this.blizzardService.fetchCharacterProfile(
      dto.name,
      dto.realm,
      dto.region,
      dto.gameVariant,
    );

    // Fetch equipment (non-fatal)
    const equipment = await this.blizzardService.fetchCharacterEquipment(
      dto.name,
      dto.realm,
      dto.region,
      dto.gameVariant,
    );

    // Find the WoW game in the registry by slug based on variant
    const slugCandidates =
      dto.gameVariant === 'retail'
        ? ['wow', 'world-of-warcraft']
        : ['wow-classic', 'wow-classic-era'];
    const [wowGame] = await this.db
      .select()
      .from(schema.gameRegistry)
      .where(inArray(schema.gameRegistry.slug, slugCandidates))
      .limit(1);

    if (!wowGame) {
      throw new NotFoundException(
        'World of Warcraft is not registered in the game registry',
      );
    }

    // Create the character with Blizzard data
    try {
      return await this.db.transaction(async (tx) => {
        if (dto.isMain) {
          await tx
            .update(schema.characters)
            .set({ isMain: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.characters.userId, userId),
                eq(schema.characters.gameId, wowGame.id),
                eq(schema.characters.isMain, true),
              ),
            );
        }

        const [character] = await tx
          .insert(schema.characters)
          .values({
            userId,
            gameId: wowGame.id,
            name: profile.name,
            realm: profile.realm,
            class: profile.class,
            spec: profile.spec,
            role: profile.role,
            isMain: dto.isMain ?? false,
            itemLevel: profile.itemLevel,
            avatarUrl: profile.avatarUrl,
            renderUrl: profile.renderUrl,
            level: profile.level,
            race: profile.race,
            faction: profile.faction,
            lastSyncedAt: new Date(),
            profileUrl: profile.profileUrl,
            region: dto.region,
            gameVariant: dto.gameVariant,
            equipment: equipment,
          })
          .returning();

        this.logger.log(
          `User ${userId} imported WoW character ${character.id} (${profile.name}-${profile.realm})`,
        );
        return this.mapToDto(character);
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error, 'unique_user_game_character')) {
        throw new ConflictException(
          `Character ${profile.name} on ${profile.realm} already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Refresh a character's data from the Blizzard Armory API (ROK-234).
   * Enforces a 5-minute cooldown between manual refreshes.
   */
  async refreshFromBlizzard(
    userId: number,
    characterId: string,
    dto: RefreshCharacterDto,
  ): Promise<CharacterDto> {
    const character = await this.findOne(userId, characterId);

    if (!character.realm) {
      throw new NotFoundException(
        'Character has no realm — cannot refresh from Armory',
      );
    }

    // Enforce 5-minute cooldown
    if (character.lastSyncedAt) {
      const lastSync = new Date(character.lastSyncedAt);
      const cooldownMs = 5 * 60 * 1000;
      const elapsed = Date.now() - lastSync.getTime();
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        throw new HttpException(
          `Refresh on cooldown. Try again in ${remaining}s`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Use persisted region/gameVariant if available, else fall back to dto
    const region = character.region ?? dto.region;
    const gameVariant =
      (character.gameVariant as RefreshCharacterDto['gameVariant']) ??
      dto.gameVariant;

    const profile = await this.blizzardService.fetchCharacterProfile(
      character.name,
      character.realm,
      region,
      gameVariant,
    );

    const equipment = await this.blizzardService.fetchCharacterEquipment(
      character.name,
      character.realm,
      region,
      gameVariant,
    );

    const [updated] = await this.db
      .update(schema.characters)
      .set({
        class: profile.class,
        spec: profile.spec,
        role: profile.role,
        itemLevel: profile.itemLevel,
        avatarUrl: profile.avatarUrl,
        renderUrl: profile.renderUrl,
        level: profile.level,
        race: profile.race,
        faction: profile.faction,
        lastSyncedAt: new Date(),
        profileUrl: profile.profileUrl,
        region,
        gameVariant,
        equipment: equipment,
        updatedAt: new Date(),
      })
      .where(eq(schema.characters.id, characterId))
      .returning();

    this.logger.log(
      `User ${userId} refreshed character ${characterId} from Armory`,
    );
    return this.mapToDto(updated);
  }

  /**
   * Get a single character by ID (public — no ownership check).
   * Used for the character detail page.
   */
  async findOnePublic(characterId: string): Promise<CharacterDto> {
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);

    if (!character) {
      throw new NotFoundException(`Character ${characterId} not found`);
    }

    return this.mapToDto(character);
  }

  /**
   * Sync all Blizzard-linked characters (for auto-sync cron).
   * Iterates characters with persisted region + gameVariant and refreshes from Blizzard.
   */
  async syncAllBlizzardCharacters(): Promise<{
    synced: number;
    failed: number;
  }> {
    const blizzardCharacters = await this.db
      .select()
      .from(schema.characters)
      .where(
        and(
          isNotNull(schema.characters.region),
          isNotNull(schema.characters.gameVariant),
        ),
      );

    let synced = 0;
    let failed = 0;

    for (const char of blizzardCharacters) {
      try {
        const profile = await this.blizzardService.fetchCharacterProfile(
          char.name,
          char.realm!,
          char.region!,
          char.gameVariant as
            | 'retail'
            | 'classic_era'
            | 'classic'
            | 'classic_anniversary',
        );

        const equipment = await this.blizzardService.fetchCharacterEquipment(
          char.name,
          char.realm!,
          char.region!,
          char.gameVariant as
            | 'retail'
            | 'classic_era'
            | 'classic'
            | 'classic_anniversary',
        );

        await this.db
          .update(schema.characters)
          .set({
            class: profile.class,
            spec: profile.spec,
            role: profile.role,
            itemLevel: profile.itemLevel,
            avatarUrl: profile.avatarUrl,
            renderUrl: profile.renderUrl,
            level: profile.level,
            race: profile.race,
            faction: profile.faction,
            lastSyncedAt: new Date(),
            profileUrl: profile.profileUrl,
            equipment: equipment,
            updatedAt: new Date(),
          })
          .where(eq(schema.characters.id, char.id));

        synced++;
      } catch (err) {
        this.logger.warn(
          `Auto-sync failed for character ${char.id} (${char.name}): ${err}`,
        );
        failed++;
      }

      // 500ms delay between API calls to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { synced, failed };
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
   * Check if an error is a Drizzle unique constraint violation.
   * Drizzle wraps Postgres errors — constraint name may be in cause or message.
   */
  private isUniqueViolation(error: unknown, constraintName: string): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message ?? '';
    const causeMsg =
      error.cause instanceof Error ? (error.cause.message ?? '') : '';
    return msg.includes(constraintName) || causeMsg.includes(constraintName);
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
      renderUrl: row.renderUrl ?? null,
      level: row.level,
      race: row.race,
      faction: row.faction as CharacterDto['faction'],
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      profileUrl: row.profileUrl,
      region: row.region ?? null,
      gameVariant: row.gameVariant ?? null,
      equipment: (row.equipment as CharacterDto['equipment']) ?? null,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
