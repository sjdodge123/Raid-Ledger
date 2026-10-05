/**
 * WoW: Forever's character-identity adapter (ROK-1733). Core resolves it via
 * EXTENSION_POINTS.CHARACTER_IDENTITY for the Forever slug and calls it on
 * manual character create/update; every rule lives in the helpers beside it.
 */
import { Injectable } from '@nestjs/common';
import type {
  CreateCharacterDto,
  UpdateCharacterDto,
} from '@raid-ledger/contract';
import type {
  CharacterIdentityProvider,
  IdentityDb,
} from '../plugin-host/extension-points';
import * as forever from './wow-forever-identity.helpers';
import { WOW_COMMON_MANIFEST } from './manifest';

@Injectable()
export class WowForeverIdentityProvider implements CharacterIdentityProvider {
  readonly gameSlugs = [forever.WOW_FOREVER_GAME_SLUG];
  readonly pluginSlug = WOW_COMMON_MANIFEST.id;

  prepareCreate(
    game: { slug: string },
    dto: CreateCharacterDto,
  ): CreateCharacterDto {
    return forever.prepareCreateDto(game, dto);
  }

  prepareUpdate(
    db: IdentityDb,
    userId: number,
    game: { slug: string },
    character: { id: string; gameId: number; region: string | null },
    dto: UpdateCharacterDto,
  ): Promise<UpdateCharacterDto> {
    return forever.prepareUpdateForGame(db, userId, game, character, dto);
  }

  checkClaim(
    tx: IdentityDb,
    args: { gameId: number; userId: number; name: string; region: string },
  ): Promise<void> {
    return forever.checkRegionClaim(tx, args);
  }

  rethrowIdentityViolation(
    error: unknown,
    name: string,
    region: string | null | undefined,
  ): void {
    forever.rethrowForeverViolation(error, name, region);
  }
}
