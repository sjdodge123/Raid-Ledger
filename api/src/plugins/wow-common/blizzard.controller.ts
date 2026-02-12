import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BlizzardService } from './blizzard.service';
import { WowRegionSchema, WowGameVariantSchema } from '@raid-ledger/contract';
import type { WowGameVariant } from '@raid-ledger/contract';
import {
  RequirePlugin,
  PluginActiveGuard,
} from '../plugin-host/plugin-active.guard';

/**
 * Controller for Blizzard API endpoints (ROK-234 UX refinements).
 * All routes require the blizzard plugin to be active (ROK-242).
 * - Realm list: public (realm names aren't sensitive)
 * - Character preview: requires auth (calls Blizzard API on user's behalf)
 */
@Controller('blizzard')
@RequirePlugin('blizzard')
@UseGuards(PluginActiveGuard)
export class BlizzardController {
  private readonly logger = new Logger(BlizzardController.name);

  constructor(private readonly blizzardService: BlizzardService) {}

  /**
   * GET /blizzard/realms?region=us&gameVariant=retail
   * Returns realm list for autocomplete. Public endpoint.
   */
  @Get('realms')
  async getRealms(
    @Query('region') region?: string,
    @Query('gameVariant') gameVariant?: string,
  ) {
    const parsed = WowRegionSchema.safeParse(region ?? 'us');
    if (!parsed.success) {
      throw new BadRequestException(
        'Invalid region. Must be one of: us, eu, kr, tw',
      );
    }

    const variant = this.parseGameVariant(gameVariant);
    const realms = await this.blizzardService.fetchRealmList(
      parsed.data,
      variant,
    );
    return { data: realms };
  }

  /**
   * GET /blizzard/character-preview?name=X&realm=Y&region=Z&gameVariant=retail
   * Preview a character without saving. Requires auth.
   */
  @Get('character-preview')
  @UseGuards(AuthGuard('jwt'))
  async getCharacterPreview(
    @Query('name') name?: string,
    @Query('realm') realm?: string,
    @Query('region') region?: string,
    @Query('gameVariant') gameVariant?: string,
  ) {
    if (!name?.trim()) {
      throw new BadRequestException('Character name is required');
    }
    if (!realm?.trim()) {
      throw new BadRequestException('Realm is required');
    }

    const parsedRegion = WowRegionSchema.safeParse(region ?? 'us');
    if (!parsedRegion.success) {
      throw new BadRequestException(
        'Invalid region. Must be one of: us, eu, kr, tw',
      );
    }

    const variant = this.parseGameVariant(gameVariant);
    return this.blizzardService.fetchCharacterProfile(
      name.trim(),
      realm.trim(),
      parsedRegion.data,
      variant,
    );
  }

  /**
   * GET /blizzard/instances?gameVariant=retail&type=dungeon&region=us
   * Returns list of dungeon or raid instances for content selection.
   */
  @Get('instances')
  async getInstances(
    @Query('gameVariant') gameVariant?: string,
    @Query('type') type?: string,
    @Query('region') region?: string,
  ) {
    if (!type || (type !== 'dungeon' && type !== 'raid')) {
      throw new BadRequestException(
        'type is required and must be one of: dungeon, raid',
      );
    }

    const parsedRegion = WowRegionSchema.safeParse(region ?? 'us');
    if (!parsedRegion.success) {
      throw new BadRequestException(
        'Invalid region. Must be one of: us, eu, kr, tw',
      );
    }

    const variant = this.parseGameVariant(gameVariant);
    try {
      const { dungeons, raids } = await this.blizzardService.fetchAllInstances(
        parsedRegion.data,
        variant,
      );
      return { data: type === 'dungeon' ? dungeons : raids };
    } catch (err) {
      this.logger.error(`Failed to fetch instances: ${err}`);
      throw new InternalServerErrorException(
        `Failed to fetch instances: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * GET /blizzard/instance/:id?gameVariant=retail&region=us
   * Returns detailed info for a specific instance (level requirements, player count).
   */
  @Get('instance/:id')
  async getInstanceDetail(
    @Param('id', ParseIntPipe) id: number,
    @Query('gameVariant') gameVariant?: string,
    @Query('region') region?: string,
  ) {
    const parsedRegion = WowRegionSchema.safeParse(region ?? 'us');
    if (!parsedRegion.success) {
      throw new BadRequestException(
        'Invalid region. Must be one of: us, eu, kr, tw',
      );
    }

    const variant = this.parseGameVariant(gameVariant);
    return this.blizzardService.fetchInstanceDetail(
      id,
      parsedRegion.data,
      variant,
    );
  }

  /** Parse and validate gameVariant query param (defaults to 'retail') */
  private parseGameVariant(raw?: string): WowGameVariant {
    if (!raw) return 'retail';
    const parsed = WowGameVariantSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(
        'Invalid gameVariant. Must be one of: retail, classic_era, classic',
      );
    }
    return parsed.data;
  }
}
