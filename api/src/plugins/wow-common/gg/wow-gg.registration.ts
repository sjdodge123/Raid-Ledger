import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  GG_PLUGIN_CARD_ORDER_BASE,
  GgCardRegistry,
} from '../../core/gg/gg-card.registry';
import { WOW_COMMON_MANIFEST } from '../manifest';
import { wowLevelsYearProducer } from './wow-gg.producer';

/**
 * ROK-2187 — registers the WoW "levels dinged" GG card (owner `blizzard`,
 * manifest `gg-card` `wow-levels`), after the Valheim card.
 */
@Injectable()
export class WowGgCardRegistration implements OnModuleInit {
  constructor(private readonly ggCards: GgCardRegistry) {}

  onModuleInit(): void {
    this.ggCards.register(
      WOW_COMMON_MANIFEST.id,
      'wow-levels',
      wowLevelsYearProducer,
      GG_PLUGIN_CARD_ORDER_BASE + 10,
    );
  }
}
