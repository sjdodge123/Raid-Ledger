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
import { eq, and, asc, inArray, isNotNull, ne, ilike } from 'drizzle-orm';
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
import { EnrichmentsService } from '../enrichments/enrichments.service';
import {
  fetchFullProfile,
  buildSyncUpdateFields,
} from './characters-sync.helpers';
import {
  mapCharacterToDto,
  resolveMainStatus,
  demoteExistingMain,
} from './characters-mapping.helpers';

type CharProfile = { name: string; realm: string; [k: string]: unknown };

interface ImportTxParams {
  tx: PostgresJsDatabase<typeof schema>;
  userId: number;
  gameId: number;
  profile: CharProfile;
  dto: ImportWowCharacterDto;
  equipment: unknown;
  talents: unknown;
}

/**
 * Service for managing player characters (ROK-130).
 * Supports Main/Alt designation with enforced single main per game.
 */
@Injectable()
export class CharactersService {
  private readonly logger = new Logger(CharactersService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly enrichmentsService: EnrichmentsService,
  ) {}

  /** Find a CharacterSyncAdapter that can handle the given game variant. */
  private findCharacterSyncAdapter(
    gameVariant?: string,
  ): CharacterSyncAdapter | undefined {
    const adapters =
      this.pluginRegistry.getAdaptersForExtensionPoint<CharacterSyncAdapter>(
        EXTENSION_POINTS.CHARACTER_SYNC,
      );
    const seen = new Set<CharacterSyncAdapter>();
    for (const [, adapter] of adapters) {
      if (seen.has(adapter)) continue;
      seen.add(adapter);
      if (adapter.resolveGameSlugs(gameVariant).length > 0) return adapter;
    }
    return undefined;
  }

  /** Check if a character with the same name+realm is already claimed by another user. */
  private async checkDuplicateClaim(
    tx: PostgresJsDatabase<typeof schema>,
    gameId: number,
    userId: number,
    name: string,
    realm?: string | null,
  ): Promise<void> {
    if (!realm) return;
    const [existingClaim] = await tx
      .select({ id: schema.characters.id, userId: schema.characters.userId })
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
    if (existingClaim)
      throw new ConflictException(
        `${name} on ${realm} is already claimed by another player`,
      );
  }

  /** Get the avatar URL for a character by name (ROK-414). */
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

  /** Get all characters for a user, optionally filtered by game. */
  async findAllForUser(
    userId: number,
    gameId?: number,
  ): Promise<CharacterListResponseDto> {
    const conditions = [eq(schema.characters.userId, userId)];
    if (gameId) conditions.push(eq(schema.characters.gameId, gameId));
    const chars = await this.db
      .select()
      .from(schema.characters)
      .where(and(...conditions))
      .orderBy(asc(schema.characters.displayOrder));
    return {
      data: chars.map((row) => mapCharacterToDto(row)),
      meta: { total: chars.length },
    };
  }

  /** Get a single character by ID with ownership check. */
  async findOne(userId: number, characterId: string): Promise<CharacterDto> {
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);
    if (!character)
      throw new NotFoundException(`Character ${characterId} not found`);
    if (character.userId !== userId)
      throw new ForbiddenException('You do not own this character');
    return mapCharacterToDto(character);
  }

  /** Build insert values for a new character from the DTO. */
  private buildCreateValues(
    userId: number,
    dto: CreateCharacterDto,
    shouldBeMain: boolean,
  ) {
    return {
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
    };
  }

  /** Execute the create transaction (main-swap + insert). */
  private async executeCreateTx(
    userId: number,
    dto: CreateCharacterDto,
  ): Promise<CharacterDto> {
    return this.db.transaction(async (tx) => {
      await this.checkDuplicateClaim(
        tx,
        dto.gameId,
        userId,
        dto.name,
        dto.realm,
      );
      const { shouldBeMain, charCount } = await resolveMainStatus(
        tx,
        userId,
        dto.gameId,
        dto.isMain,
      );
      if (shouldBeMain && charCount > 0)
        await demoteExistingMain(tx, userId, dto.gameId);
      const [character] = await tx
        .insert(schema.characters)
        .values(this.buildCreateValues(userId, dto, shouldBeMain))
        .returning();
      this.logger.log(
        `User ${userId} created character ${character.id} (${character.name})${shouldBeMain ? ' [main]' : ''}`,
      );
      return mapCharacterToDto(character);
    });
  }

  /** Create a new character with main-swap behavior (ROK-206). */
  async create(userId: number, dto: CreateCharacterDto): Promise<CharacterDto> {
    const [game] = await this.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, dto.gameId))
      .limit(1);
    if (!game) throw new NotFoundException(`Game ${dto.gameId} not found`);
    try {
      return await this.executeCreateTx(userId, dto);
    } catch (error: unknown) {
      if (this.isUniqueViolation(error, 'unique_user_game_character'))
        throw new ConflictException(
          `Character ${dto.name} already exists for this game/realm`,
        );
      throw error;
    }
  }

  /** Update a character. */
  async update(
    userId: number,
    characterId: string,
    dto: UpdateCharacterDto,
  ): Promise<CharacterDto> {
    await this.findOne(userId, characterId);
    const [updated] = await this.db
      .update(schema.characters)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(schema.characters.id, characterId))
      .returning();
    this.logger.log(`User ${userId} updated character ${characterId}`);
    return mapCharacterToDto(updated);
  }

  /** Delete a character with auto-promote (ROK-206). */
  async delete(userId: number, characterId: string): Promise<void> {
    const character = await this.findOne(userId, characterId);
    await this.db
      .delete(schema.characters)
      .where(eq(schema.characters.id, characterId));
    await this.autoPromoteAfterDelete(userId, character.gameId);
    this.logger.log(`User ${userId} deleted character ${characterId}`);
  }

  /** After deletion, promote the lowest-order character to main if no main exists. */
  private async autoPromoteAfterDelete(
    userId: number,
    gameId: number,
  ): Promise<void> {
    const remaining = await this.db
      .select()
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.userId, userId),
          eq(schema.characters.gameId, gameId),
        ),
      )
      .orderBy(asc(schema.characters.displayOrder));
    if (remaining.length > 0 && !remaining.some((c) => c.isMain)) {
      const promote = remaining[0];
      await this.db
        .update(schema.characters)
        .set({ isMain: true, updatedAt: new Date() })
        .where(eq(schema.characters.id, promote.id));
      this.logger.log(
        `Auto-promoted character ${promote.id} (${promote.name}) to main`,
      );
    }
  }

  /** Set a character as the main for its game. */
  async setMain(userId: number, characterId: string): Promise<CharacterDto> {
    const character = await this.findOne(userId, characterId);
    return this.db.transaction(async (tx) => {
      await demoteExistingMain(tx, userId, character.gameId);
      const [updated] = await tx
        .update(schema.characters)
        .set({ isMain: true, updatedAt: new Date() })
        .where(eq(schema.characters.id, characterId))
        .returning();
      this.logger.log(
        `User ${userId} set character ${characterId} as main for game ${character.gameId}`,
      );
      return mapCharacterToDto(updated);
    });
  }

  /** Import a character from an external game API via adapter (ROK-234, ROK-237). */
  async importExternal(
    userId: number,
    dto: ImportWowCharacterDto,
  ): Promise<CharacterDto> {
    const adapter = this.findCharacterSyncAdapter(dto.gameVariant);
    if (!adapter)
      throw new NotFoundException(
        'No character sync adapter found for this game variant',
      );
    const fetched = await fetchFullProfile(
      adapter,
      dto.name,
      dto.realm,
      dto.region,
      dto.gameVariant,
    );
    await this.validateUserExists(userId);
    const game = await this.resolveGameByVariant(adapter, dto.gameVariant);
    return this.insertOrMergeImport(userId, game.id, fetched, dto);
  }

  /** Try inserting an imported character; fall back to merge on conflict. */
  private async insertOrMergeImport(
    userId: number,
    gameId: number,
    fetched: Awaited<ReturnType<typeof fetchFullProfile>>,
    dto: ImportWowCharacterDto,
  ): Promise<CharacterDto> {
    try {
      return await this.insertImportedCharacter(
        userId,
        gameId,
        fetched.profile,
        dto,
        fetched.equipment,
        fetched.talents,
      );
    } catch (error: unknown) {
      if (this.isUniqueViolation(error, 'unique_user_game_character'))
        return this.mergeIntoExisting(
          userId,
          gameId,
          fetched.profile,
          dto,
          fetched.equipment,
          fetched.talents,
        );
      throw error;
    }
  }

  /** Validate that a user exists. */
  private async validateUserExists(userId: number): Promise<void> {
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user)
      throw new NotFoundException(
        `User ${userId} not found — cannot import character`,
      );
  }

  /** Resolve game by slug candidates from adapter. */
  private async resolveGameByVariant(
    adapter: CharacterSyncAdapter,
    gameVariant: string,
  ): Promise<typeof schema.games.$inferSelect> {
    const slugCandidates = adapter.resolveGameSlugs(gameVariant);
    const [game] = await this.db
      .select()
      .from(schema.games)
      .where(inArray(schema.games.slug, slugCandidates))
      .limit(1);
    if (!game)
      throw new NotFoundException('Game not found in the games catalog');
    return game;
  }

  /** Build import insert values from profile and sync fields. */
  private buildImportInsertValues(
    userId: number,
    gameId: number,
    profile: { name: string; realm: string; [k: string]: unknown },
    dto: ImportWowCharacterDto,
    equipment: unknown,
    talents: unknown,
    shouldBeMain: boolean,
  ) {
    const syncFields = buildSyncUpdateFields(
      profile as never,
      equipment,
      talents,
      { region: dto.region, gameVariant: dto.gameVariant },
    );
    return {
      userId,
      gameId,
      name: profile.name,
      realm: profile.realm,
      ...syncFields,
      isMain: shouldBeMain,
    };
  }

  /** Persist the imported character and log the result. */
  private async commitImportedChar(
    tx: PostgresJsDatabase<typeof schema>,
    userId: number,
    profile: { name: string; realm: string; [k: string]: unknown },
    values: typeof schema.characters.$inferInsert,
    shouldBeMain: boolean,
  ): Promise<CharacterDto> {
    const [character] = await tx
      .insert(schema.characters)
      .values(values)
      .returning();
    this.logger.log(
      `User ${userId} imported character ${character.id} (${profile.name}-${profile.realm})${shouldBeMain ? ' [main]' : ''}`,
    );
    return mapCharacterToDto(character);
  }

  /** Resolve main status and demote existing main if needed. */
  private async resolveAndDemoteMain(
    tx: PostgresJsDatabase<typeof schema>,
    userId: number,
    gameId: number,
    isMain: boolean | undefined,
  ): Promise<boolean> {
    const { shouldBeMain, charCount } = await resolveMainStatus(
      tx,
      userId,
      gameId,
      isMain,
    );
    if (shouldBeMain && charCount > 0)
      await demoteExistingMain(tx, userId, gameId);
    return shouldBeMain;
  }

  /** Execute the import transaction body. */
  private async executeImportTx(p: ImportTxParams): Promise<CharacterDto> {
    const { tx, userId, gameId, profile, dto, equipment, talents } = p;
    await this.checkDuplicateClaim(
      tx,
      gameId,
      userId,
      profile.name,
      profile.realm,
    );
    const shouldBeMain = await this.resolveAndDemoteMain(
      tx,
      userId,
      gameId,
      dto.isMain,
    );
    const values = this.buildImportInsertValues(
      userId,
      gameId,
      profile,
      dto,
      equipment,
      talents,
      shouldBeMain,
    );
    return this.commitImportedChar(tx, userId, profile, values, shouldBeMain);
  }

  /** Insert an imported character in a transaction with main-swap. */
  private async insertImportedCharacter(
    userId: number,
    gameId: number,
    profile: { name: string; realm: string; [k: string]: unknown },
    dto: ImportWowCharacterDto,
    equipment: unknown,
    talents: unknown,
  ): Promise<CharacterDto> {
    return this.db.transaction(async (tx) => {
      return this.executeImportTx({
        tx,
        userId,
        gameId,
        profile,
        dto,
        equipment,
        talents,
      });
    });
  }

  /** Find an existing character by user+game+name+realm. */
  private async findExistingByProfile(
    userId: number,
    gameId: number,
    name: string,
    realm: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.userId, userId),
          eq(schema.characters.gameId, gameId),
          ilike(schema.characters.name, name),
          eq(schema.characters.realm, realm),
        ),
      )
      .limit(1);
    return existing;
  }

  /** Merge imported data into an existing local character (ROK-578). */
  private async mergeIntoExisting(
    userId: number,
    gameId: number,
    profile: { name: string; realm: string; [k: string]: unknown },
    dto: ImportWowCharacterDto,
    equipment: unknown,
    talents: unknown,
  ): Promise<CharacterDto> {
    const existing = await this.findExistingByProfile(
      userId,
      gameId,
      profile.name,
      profile.realm,
    );
    if (!existing)
      throw new ConflictException(
        `Character ${profile.name} on ${profile.realm} already exists`,
      );
    const fields = buildSyncUpdateFields(profile as never, equipment, talents, {
      region: dto.region,
      gameVariant: dto.gameVariant,
    });
    return this.applyMerge(userId, existing.id, profile, fields);
  }

  /** Apply merge update and return DTO. */
  private async applyMerge(
    userId: number,
    existingId: string,
    profile: { name: string; realm: string },
    fields: Record<string, unknown>,
  ): Promise<CharacterDto> {
    const [merged] = await this.db
      .update(schema.characters)
      .set(fields)
      .where(eq(schema.characters.id, existingId))
      .returning();
    this.logger.log(
      `User ${userId} merged import into existing character ${existingId} (${profile.name}-${profile.realm})`,
    );
    return mapCharacterToDto(merged);
  }

  /** Resolve region/variant for a refresh, falling back to DTO values. */
  private resolveRefreshParams(
    character: CharacterDto,
    dto: RefreshCharacterDto,
  ) {
    return {
      region: character.region ?? dto.region,
      gameVariant:
        (character.gameVariant as RefreshCharacterDto['gameVariant']) ??
        dto.gameVariant,
    };
  }

  /** Validate and prepare refresh parameters. */
  private prepareRefresh(
    character: CharacterDto,
    dto: RefreshCharacterDto,
  ): { region: string; gameVariant: string; adapter: CharacterSyncAdapter } {
    if (!character.realm)
      throw new NotFoundException(
        'Character has no realm — cannot refresh from external source',
      );
    this.enforceCooldown(character.lastSyncedAt);
    const { region, gameVariant } = this.resolveRefreshParams(character, dto);
    const adapter = this.findCharacterSyncAdapter(gameVariant);
    if (!adapter)
      throw new NotFoundException(
        'No character sync adapter found for this game variant',
      );
    return { region, gameVariant, adapter };
  }

  /** Apply refresh fields to DB and return updated character. */
  private async applyRefreshUpdate(
    userId: number,
    characterId: string,
    fields: Record<string, unknown>,
    gameId: number,
  ): Promise<CharacterDto> {
    const [updated] = await this.db
      .update(schema.characters)
      .set(fields)
      .where(eq(schema.characters.id, characterId))
      .returning();
    this.logger.log(
      `User ${userId} refreshed character ${characterId} from external source`,
    );
    this.enqueueCharacterEnrichmentsBackground(characterId, gameId);
    return mapCharacterToDto(updated);
  }

  /** Refresh a character's data from an external game API (ROK-234, ROK-237). */
  async refreshExternal(
    userId: number,
    characterId: string,
    dto: RefreshCharacterDto,
  ): Promise<CharacterDto> {
    const character = await this.findOne(userId, characterId);
    const { region, gameVariant, adapter } = this.prepareRefresh(
      character,
      dto,
    );
    const { profile, talents, equipment } = await fetchFullProfile(
      adapter,
      character.name,
      character.realm!,
      region,
      gameVariant,
    );
    const fields = buildSyncUpdateFields(profile, equipment, talents, {
      region,
      gameVariant,
    });
    return this.applyRefreshUpdate(
      userId,
      characterId,
      fields,
      character.gameId,
    );
  }

  /** Enforce 5-minute refresh cooldown. */
  private enforceCooldown(lastSyncedAt: string | null): void {
    if (!lastSyncedAt) return;
    const cooldownMs = 5 * 60 * 1000;
    const elapsed = Date.now() - new Date(lastSyncedAt).getTime();
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
      throw new HttpException(
        `Refresh on cooldown. Try again in ${remaining}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Fire-and-forget: enqueue enrichment jobs for a character. */
  private enqueueCharacterEnrichmentsBackground(
    characterId: string,
    gameId: number,
  ): void {
    this.db
      .select({ slug: schema.games.slug })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1)
      .then(([game]) => {
        if (game)
          return this.enrichmentsService.enqueueCharacterEnrichments(
            characterId,
            game.slug,
          );
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to enqueue enrichments for character ${characterId}: ${err}`,
        );
      });
  }

  /** Get a single character by ID (public — no ownership check). */
  async findOnePublic(characterId: string): Promise<CharacterDto> {
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);
    if (!character)
      throw new NotFoundException(`Character ${characterId} not found`);
    const dto = mapCharacterToDto(character);
    const enrichmentRows =
      await this.enrichmentsService.getEnrichmentsForEntity(
        'character',
        characterId,
      );
    return enrichmentRows.length > 0
      ? { ...dto, enrichments: enrichmentRows }
      : dto;
  }

  /** Sync all externally-linked characters (for auto-sync cron). */
  async syncAllCharacters(): Promise<{ synced: number; failed: number }> {
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
      const result = await this.syncSingleCharacter(char);
      if (result === 'synced') synced++;
      else if (result === 'failed') failed++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { synced, failed };
  }

  /** Perform sync for a single character (no error handling). */
  private async performCharacterSync(
    char: typeof schema.characters.$inferSelect,
  ): Promise<'synced' | 'skipped'> {
    const variant = char.gameVariant as string;
    const adapter = this.findCharacterSyncAdapter(variant);
    if (!adapter) {
      this.logger.debug(
        `No adapter for character ${char.id} (variant: ${variant}), skipping`,
      );
      return 'skipped';
    }
    const { profile, talents, equipment } = await fetchFullProfile(
      adapter,
      char.name,
      char.realm!,
      char.region!,
      variant,
    );
    await this.db
      .update(schema.characters)
      .set(buildSyncUpdateFields(profile, equipment, talents))
      .where(eq(schema.characters.id, char.id));
    return 'synced';
  }

  /** Sync a single external character. Returns 'synced', 'failed', or 'skipped'. */
  private async syncSingleCharacter(
    char: typeof schema.characters.$inferSelect,
  ): Promise<'synced' | 'failed' | 'skipped'> {
    try {
      return await this.performCharacterSync(char);
    } catch (err) {
      this.logger.warn(
        `Auto-sync failed for character ${char.id} (${char.name}): ${err}`,
      );
      return 'failed';
    }
  }

  /** Check if an error is a Drizzle unique constraint violation. */
  private isUniqueViolation(error: unknown, constraintName: string): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message ?? '';
    const causeMsg =
      error.cause instanceof Error ? (error.cause.message ?? '') : '';
    return msg.includes(constraintName) || causeMsg.includes(constraintName);
  }
}
