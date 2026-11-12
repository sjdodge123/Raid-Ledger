import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  GgCardRegistry,
  ggCoreCardOrder,
  type GgCardProducer,
} from './gg-card.registry';
import {
  produceEventsCard,
  produceOnTimeCard,
  produceRhythmCard,
} from './metrics/events.queries';
import { produceHubsCard } from './metrics/hubs.queries';
import { produceSuperlativeCard } from './metrics/superlatives.queries';
import { produceVoiceCard } from './metrics/voice.queries';

/** Placeholder until lane 3 lands the real Core producer: the card is omitted. */
const pending: GgCardProducer = () => Promise.resolve(null);

/**
 * ROK-2187 — Core's twelve GG cards. Each call is a literal
 * `register(CORE_PLUGIN_ID, '<id>', …)` so the hub-ownership guard can match
 * it to the `core` manifest's `gg-card` entries.
 * Lane 3a landed events/on-time/rhythm/voice/hubs/superlative; the rest
 * (intro, hours, top-games, new-games, people, summary) are lane 3b's.
 */
@Injectable()
export class CoreGgCardRegistration implements OnModuleInit {
  constructor(private readonly ggCards: GgCardRegistry) {}

  onModuleInit(): void {
    this.registerEventCards();
    this.registerPlayCards();
  }

  /** Cards 1–4 (intro, events, on-time, rhythm). */
  private registerEventCards(): void {
    const o = ggCoreCardOrder;
    this.ggCards.register(CORE_PLUGIN_ID, 'intro', pending, o('intro'));
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'events',
      produceEventsCard,
      o('events'),
    );
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'on-time',
      produceOnTimeCard,
      o('on-time'),
    );
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'rhythm',
      produceRhythmCard,
      o('rhythm'),
    );
  }

  /** Cards 5–12 (hours … summary). */
  private registerPlayCards(): void {
    const o = ggCoreCardOrder;
    this.ggCards.register(CORE_PLUGIN_ID, 'hours', pending, o('hours'));
    this.ggCards.register(CORE_PLUGIN_ID, 'top-games', pending, o('top-games'));
    this.ggCards.register(CORE_PLUGIN_ID, 'new-games', pending, o('new-games'));
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'voice',
      produceVoiceCard,
      o('voice'),
    );
    this.ggCards.register(CORE_PLUGIN_ID, 'people', pending, o('people'));
    this.ggCards.register(CORE_PLUGIN_ID, 'hubs', produceHubsCard, o('hubs'));
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'superlative',
      produceSuperlativeCard,
      o('superlative'),
    );
    this.ggCards.register(CORE_PLUGIN_ID, 'summary', pending, o('summary'));
  }
}
