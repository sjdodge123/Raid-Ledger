import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  GG_PLUGIN_CARD_ORDER_BASE,
  GgCardRegistry,
  type GgCardProducer,
} from '../../core/gg/gg-card.registry';
import { WOW_COMMON_MANIFEST } from '../manifest';

/** Placeholder until the WoW levels producer lands: the card is omitted. */
const pending: GgCardProducer = () => Promise.resolve(null);

/**
 * ROK-2187 — registers the WoW "levels dinged" GG card (owner `blizzard`,
 * manifest `gg-card` `wow-levels`), after the Valheim card.
 * TODO(ROK-2187 WoW lane): replace `pending` with `wow-gg.producer.ts`.
 */
@Injectable()
export class WowGgCardRegistration implements OnModuleInit {
  constructor(private readonly ggCards: GgCardRegistry) {}

  onModuleInit(): void {
    this.ggCards.register(WOW_COMMON_MANIFEST.id, 'wow-levels', pending, GG_PLUGIN_CARD_ORDER_BASE + 10);
  }
}
