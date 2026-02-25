import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { BossEncountersService } from './boss-encounters.service';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { WOW_COMMON_MANIFEST } from './manifest';

/**
 * API controller for boss encounter and loot table data.
 * All routes gated behind PluginActiveGuard — requires Blizzard plugin to be active.
 *
 * ROK-244: Variant-Aware Boss & Loot Table Seed Data
 */
@Controller('plugins/wow-classic')
@UseGuards(PluginActiveGuard)
@RequirePlugin(WOW_COMMON_MANIFEST.id)
export class BossEncountersController {
  constructor(private readonly bossEncountersService: BossEncountersService) {}

  private static readonly VALID_VARIANTS = new Set([
    'classic_era',
    'classic_era_sod',
    'classic_anniversary',
    'classic',
    'retail',
  ]);

  /**
   * GET /plugins/wow-classic/instances/:id/bosses?variant=classic_era
   *
   * Returns boss encounters for a specific instance, filtered by variant.
   * Variant determines which expansion's encounters are included:
   *   - classic_era: ['classic']
   *   - classic_era_sod: ['classic', 'sod']
   *   - classic_anniversary: ['classic', 'tbc']
   *   - classic (Cata): ['classic', 'tbc', 'wotlk', 'cata']
   */
  @Get('instances/:id/bosses')
  async getBossesForInstance(
    @Param('id', ParseIntPipe) instanceId: number,
    @Query('variant') variant: string = 'classic_era',
  ) {
    if (!BossEncountersController.VALID_VARIANTS.has(variant)) {
      throw new BadRequestException(
        `Invalid variant "${variant}". Valid variants: ${[...BossEncountersController.VALID_VARIANTS].join(', ')}`,
      );
    }
    return this.bossEncountersService.getBossesForInstance(instanceId, variant);
  }

  /**
   * GET /plugins/wow-classic/bosses/:id/loot?variant=classic_era
   *
   * Returns the loot table for a specific boss encounter, filtered by variant.
   */
  @Get('bosses/:id/loot')
  async getLootForBoss(
    @Param('id', ParseIntPipe) bossId: number,
    @Query('variant') variant: string = 'classic_era',
  ) {
    if (!BossEncountersController.VALID_VARIANTS.has(variant)) {
      throw new BadRequestException(
        `Invalid variant "${variant}". Valid variants: ${[...BossEncountersController.VALID_VARIANTS].join(', ')}`,
      );
    }
    return this.bossEncountersService.getLootForBoss(bossId, variant);
  }
}
