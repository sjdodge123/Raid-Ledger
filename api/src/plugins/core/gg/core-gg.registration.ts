import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import { GgCardRegistry, ggCoreCardOrder } from './gg-card.registry';
import {
  produceEventsCard,
  produceOnTimeCard,
  produceRhythmCard,
} from './metrics/events.queries';
import {
  produceHoursCard,
  produceNewGamesCard,
  produceTopGamesCard,
} from './metrics/games.queries';
import { produceHubsCard } from './metrics/hubs.queries';
import { producePeopleCard } from './metrics/people.queries';
import {
  produceIntroCard,
  produceSummaryCard,
} from './metrics/summary.queries';
import { produceSuperlativeCard } from './metrics/superlatives.queries';
import { produceVoiceCard } from './metrics/voice.queries';

/**
 * ROK-2187 — Core's twelve GG cards. Each call is a literal
 * `register(CORE_PLUGIN_ID, '<id>', …)` so the hub-ownership guard can match
 * it to the `core` manifest's `gg-card` entries.
 */
@Injectable()
export class CoreGgCardRegistration implements OnModuleInit {
  constructor(private readonly ggCards: GgCardRegistry) {}

  onModuleInit(): void {
    this.registerEventCards();
    this.registerPlayCards();
    this.registerSocialCards();
  }

  /** Cards 1–4 (intro, events, on-time, rhythm). */
  private registerEventCards(): void {
    const o = ggCoreCardOrder;
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'intro',
      produceIntroCard,
      o('intro'),
    );
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

  /** Cards 5–8 (hours, top-games, new-games, voice). */
  private registerPlayCards(): void {
    const o = ggCoreCardOrder;
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'hours',
      produceHoursCard,
      o('hours'),
    );
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'top-games',
      produceTopGamesCard,
      o('top-games'),
    );
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'new-games',
      produceNewGamesCard,
      o('new-games'),
    );
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'voice',
      produceVoiceCard,
      o('voice'),
    );
  }

  /** Cards 9–12 (people, hubs, superlative, summary). */
  private registerSocialCards(): void {
    const o = ggCoreCardOrder;
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'people',
      producePeopleCard,
      o('people'),
    );
    this.ggCards.register(CORE_PLUGIN_ID, 'hubs', produceHubsCard, o('hubs'));
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'superlative',
      produceSuperlativeCard,
      o('superlative'),
    );
    this.ggCards.register(
      CORE_PLUGIN_ID,
      'summary',
      produceSummaryCard,
      o('summary'),
    );
  }
}
