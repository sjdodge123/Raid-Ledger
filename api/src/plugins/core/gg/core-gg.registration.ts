import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  GgCardRegistry,
  ggCoreCardOrder,
  type GgCardProducer,
} from './gg-card.registry';

/** Placeholder until lane 3 lands the real Core producer: the card is omitted. */
const pending: GgCardProducer = () => Promise.resolve(null);

/**
 * ROK-2187 — Core's twelve GG cards. Each call is a literal
 * `register(CORE_PLUGIN_ID, '<id>', …)` so the hub-ownership guard can match
 * it to the `core` manifest's `gg-card` entries.
 * TODO(ROK-2187 lane 3): replace each `pending` with the real producer.
 */
@Injectable()
export class CoreGgCardRegistration implements OnModuleInit {
  constructor(private readonly ggCards: GgCardRegistry) {}

  onModuleInit(): void {
    const o = ggCoreCardOrder;
    this.ggCards.register(CORE_PLUGIN_ID, 'intro', pending, o('intro'));
    this.ggCards.register(CORE_PLUGIN_ID, 'events', pending, o('events'));
    this.ggCards.register(CORE_PLUGIN_ID, 'on-time', pending, o('on-time'));
    this.ggCards.register(CORE_PLUGIN_ID, 'rhythm', pending, o('rhythm'));
    this.ggCards.register(CORE_PLUGIN_ID, 'hours', pending, o('hours'));
    this.ggCards.register(CORE_PLUGIN_ID, 'top-games', pending, o('top-games'));
    this.ggCards.register(CORE_PLUGIN_ID, 'new-games', pending, o('new-games'));
    this.ggCards.register(CORE_PLUGIN_ID, 'voice', pending, o('voice'));
    this.ggCards.register(CORE_PLUGIN_ID, 'people', pending, o('people'));
    this.ggCards.register(CORE_PLUGIN_ID, 'hubs', pending, o('hubs'));
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'superlative',
      pending,
      o('superlative'),
    );
    this.ggCards.register(CORE_PLUGIN_ID, 'summary', pending, o('summary'));
  }
}
