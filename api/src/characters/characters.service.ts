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
import {
  eq,
  and,
  asc,
  count,
  inArray,
  isNotNull,
  ne,
  ilike,
} from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  CharacterDto,
  CharacterListResponseDto,
  CreateCharacterDto,
  UpdateCharacterDto,
  ImportWowCharacterDto,
  RefreshCharacterDto,
} from '@raid-ledger/contract';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { CharacterSyncAdapter } from '../plugins/plugin-host/extension-points';

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
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  /**
   * Find a CharacterSyncAdapter that can handle the given game variant.
   */
  private findCharacterSyncAdapter(
    gameVariant?: string,
  ): CharacterSyncAdapter | undefined {
    const adapters =
      this.pluginRegistry.getAdaptersForExtensionPoint<CharacterSyncAdapter>(
        EXTENSION_POINTS.CHARACTER_SYNC,
      );

    // De-duplicate adapters (same adapter may be registered for multiple slugs)
    const seen = new Set<CharacterSyncAdapter>();
    for (const [, adapter] of adapters) {
      if (seen.has(adapter)) continue;
      seen.add(adapter);
      const slugs = adapter.resolveGameSlugs(gameVariant);
      if (slugs.length > 0) return adapter;
    }
    return undefined;
  }

  /**
   * Check if a character with the same name+realm is already claimed by another user.
   * Only applies when realm is provided — non-realm games skip this check since
   * character names aren't globally unique in non-MMO titles.
   */
  private async checkDuplicateClaim(
    tx: PostgresJsDatabase<typeof schema>,
    gameId: string,
    userId: number,
    name: string,
    realm?: string | null,
  ): Promise<void> {
    if (!realm) return; // Non-realm games: skip cross-user uniqueness check

    const [existingClaim] = await tx
      .select({
        id: schema.characters.id,
        userId: schema.characters.userId,
      })
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.gameId, gameId),
          ne(schema.characters.userId, userId),
          ilike(schema.characters.name, name),
          eq(schema.characters.realm, realm),
        ),
      )
      .limit(1);

    if (existingClaim) {
      throw new ConflictException(
        `${name} on ${realm} is already claimed by another player`,
      );
    }
  }

  /**
   * Get the avatar URL for a character by name (ROK-414).
   * Lightweight query that only fetches avatarUrl — avoids SELECT * with heavy JSONB columns.
   */
  async getAvatarUrlByName(
    userId: number,
    characterName: string,
  ): Promise<string | null> {
    const [result] = await this.db
      .select({ avatarUrl: schema.characters.avatarUrl })
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.userId, userId),
          eq(schema.characters.name, characterName),
        ),
      )
      .limit(1);
    return result?.avatarUrl ?? null;
  }

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
   * ROK-206: When isMain is true and a main already exists, the existing main
   * is automatically demoted to alt (swap behavior). First character for a
   * game is always set as main.
   * @param userId - User ID
   * @param dto - Character creation data
   * @returns Created character
   */
  async create(userId: number, dto: CreateCharacterDto): Promise<CharacterDto> {
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
        // Cross-user duplicate check (realm-only — non-MMO games skip)
        await this.checkDuplicateClaim(
          tx,
          dto.gameId,
          userId,
          dto.name,
          dto.realm,
        );

        // ROK-206: Count existing characters to auto-main the first one
        const [{ charCount }] = await tx
          .select({ charCount: count() })
          .from(schema.characters)
          .where(
            and(
              eq(schema.characters.userId, userId),
              eq(schema.characters.gameId, dto.gameId),
            ),
          );

        const shouldBeMain = dto.isMain === true || Number(charCount) === 0;

        // ROK-206: If setting as main and others exist, demote existing main first (swap)
        if (shouldBeMain && Number(charCount) > 0) {
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
            isMain: shouldBeMain,
            itemLevel: dto.itemLevel ?? null,
            avatarUrl: dto.avatarUrl ?? null,
          })
          .returning();

        this.logger.log(
          `User ${userId} created character ${character.id} (${character.name})${shouldBeMain ? ' [main]' : ''}`,
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
    // Verify ownership — also captures character details for auto-promote
    const character = await this.findOne(userId, characterId);

    await this.db
      .delete(schema.characters)
      .where(eq(schema.characters.id, characterId));

    // ROK-206: After deletion, check remaining characters for this game.
    // If the deleted character was main, promote the lowest-order remaining.
    // Also: if only one character remains for this game, ensure it's the main
    // (covers the case where a non-main was deleted leaving a single character).
    const remaining = await this.db
      .select()
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.userId, userId),
          eq(schema.characters.gameId, character.gameId),
        ),
      )
      .orderBy(asc(schema.characters.displayOrder));

    if (remaining.length > 0) {
      const hasMain = remaining.some((c) => c.isMain);

      if (!hasMain) {
        // No main exists — promote the lowest-order character
        const promote = remaining[0];
        await this.db
          .update(schema.characters)
          .set({ isMain: true, updatedAt: new Date() })
          .where(eq(schema.characters.id, promote.id));

        this.logger.log(
          `Auto-promoted character ${promote.id} (${promote.name}) to main after deletion of ${characterId}`,
        );
      }
    }

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
   * Import a character from an external game API via adapter (ROK-234, ROK-237).
   * ROK-206: When isMain is true and a main already exists, the existing main
   * is automatically demoted to alt (swap behavior).
   */
  async importExternal(
    userId: number,
    dto: ImportWowCharacterDto,
  ): Promise<CharacterDto> {
    const adapter = this.findCharacterSyncAdapter(dto.gameVariant);
    if (!adapter) {
      throw new NotFoundException(
        'No character sync adapter found for this game variant',
      );
    }

    // Fetch character data via adapter
    const profile = await adapter.fetchProfile(
      dto.name,
      dto.realm,
      dto.region,
      dto.gameVariant,
    );

    // Fetch specialization data (includes talent builds)
    let talents: unknown = null;
    if (profile.class) {
      const inferred = await adapter.fetchSpecialization(
        dto.name,
        dto.realm,
        dto.region,
        profile.class,
        dto.gameVariant,
      );
      if (!profile.spec && inferred.spec) profile.spec = inferred.spec;
      if (!profile.role && inferred.role) profile.role = inferred.role;
      talents = inferred.talents ?? null;
    }

    // Fetch equipment (non-fatal)
    const equipment = await adapter.fetchEquipment(
      dto.name,
      dto.realm,
      dto.region,
      dto.gameVariant,
    );

    // Validate user exists before inserting character (ROK-416)
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundException(
        `User ${userId} not found — cannot import character`,
      );
    }

    // Find the game in the registry by slug based on variant
    const slugCandidates = adapter.resolveGameSlugs(dto.gameVariant);
    const [game] = await this.db
      .select()
      .from(schema.gameRegistry)
      .where(inArray(schema.gameRegistry.slug, slugCandidates))
      .limit(1);

    if (!game) {
      throw new NotFoundException(
        'Game is not registered in the game registry',
      );
    }

    // Create the character with external data
    try {
      return await this.db.transaction(async (tx) => {
        // Cross-user duplicate check (realm-only — non-MMO games skip)
        await this.checkDuplicateClaim(
          tx,
          game.id,
          userId,
          profile.name,
          profile.realm,
        );

        // ROK-206: Count existing characters to auto-main the first one
        const [{ charCount }] = await tx
          .select({ charCount: count() })
          .from(schema.characters)
          .where(
            and(
              eq(schema.characters.userId, userId),
              eq(schema.characters.gameId, game.id),
            ),
          );

        const shouldBeMain = dto.isMain === true || Number(charCount) === 0;

        // ROK-206: If setting as main and others exist, demote existing main first (swap)
        if (shouldBeMain && Number(charCount) > 0) {
          await tx
            .update(schema.characters)
            .set({ isMain: false, updatedAt: new Date() })
            .where(
              and(
                eq(schema.characters.userId, userId),
                eq(schema.characters.gameId, game.id),
                eq(schema.characters.isMain, true),
              ),
            );
        }

        const [character] = await tx
          .insert(schema.characters)
          .values({
            userId,
            gameId: game.id,
            name: profile.name,
            realm: profile.realm,
            class: profile.class,
            spec: profile.spec,
            role: profile.role,
            isMain: shouldBeMain,
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
            talents: talents,
          })
          .returning();

        this.logger.log(
          `User ${userId} imported character ${character.id} (${profile.name}-${profile.realm})${shouldBeMain ? ' [main]' : ''}`,
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
   * Refresh a character's data from an external game API via adapter (ROK-234, ROK-237).
   * Enforces a 5-minute cooldown between manual refreshes.
   */
  async refreshExternal(
    userId: number,
    characterId: string,
    dto: RefreshCharacterDto,
  ): Promise<CharacterDto> {
    const character = await this.findOne(userId, characterId);

    if (!character.realm) {
      throw new NotFoundException(
        'Character has no realm — cannot refresh from external source',
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

    const adapter = this.findCharacterSyncAdapter(gameVariant);
    if (!adapter) {
      throw new NotFoundException(
        'No character sync adapter found for this game variant',
      );
    }

    const profile = await adapter.fetchProfile(
      character.name,
      character.realm,
      region,
      gameVariant,
    );

    // Fetch specialization data (includes talent builds)
    let talents: unknown = null;
    if (profile.class) {
      const inferred = await adapter.fetchSpecialization(
        character.name,
        character.realm,
        region,
        profile.class,
        gameVariant,
      );
      if (!profile.spec && inferred.spec) profile.spec = inferred.spec;
      if (!profile.role && inferred.role) profile.role = inferred.role;
      talents = inferred.talents ?? null;
    }

    const equipment = await adapter.fetchEquipment(
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
        talents: talents,
        updatedAt: new Date(),
      })
      .where(eq(schema.characters.id, characterId))
      .returning();

    this.logger.log(
      `User ${userId} refreshed character ${characterId} from external source`,
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
   * Sync all externally-linked characters (for auto-sync cron).
   * Iterates characters with persisted region + gameVariant and refreshes via adapters.
   */
  async syncAllCharacters(): Promise<{
    synced: number;
    failed: number;
  }> {
    const externalCharacters = await this.db
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

    for (const char of externalCharacters) {
      try {
        const variant = char.gameVariant as string;
        const adapter = this.findCharacterSyncAdapter(variant);
        if (!adapter) {
          this.logger.debug(
            `No adapter found for character ${char.id} (variant: ${variant}), skipping`,
          );
          continue;
        }

        const profile = await adapter.fetchProfile(
          char.name,
          char.realm!,
          char.region!,
          variant,
        );

        // Fetch specialization data (includes talent builds)
        let talents: unknown = null;
        if (profile.class) {
          const inferred = await adapter.fetchSpecialization(
            char.name,
            char.realm!,
            char.region!,
            profile.class,
            variant,
          );
          if (!profile.spec && inferred.spec) profile.spec = inferred.spec;
          if (!profile.role && inferred.role) profile.role = inferred.role;
          talents = inferred.talents ?? null;
        }

        const equipment = await adapter.fetchEquipment(
          char.name,
          char.realm!,
          char.region!,
          variant,
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
            talents: talents,
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
    const roleOverride = row.roleOverride as CharacterDto['role'];
    const role = row.role as CharacterDto['role'];
    return {
      id: row.id,
      userId: row.userId,
      gameId: row.gameId,
      name: row.name,
      realm: row.realm,
      class: row.class,
      spec: row.spec,
      role,
      roleOverride,
      effectiveRole: roleOverride ?? role,
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
      talents: row.talents ?? null,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
