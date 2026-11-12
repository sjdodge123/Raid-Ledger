import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  GG_PLUGIN_CARD_ORDER_BASE,
  GgCardRegistry,
} from '../../core/gg/gg-card.registry';
import { VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { valheimYearProducer } from './valheim-gg.producer';

/** ROK-2187 — registers the Valheim GG card (manifest `gg-card` `valheim-year`). */
@Injectable()
export class ValheimGgCardRegistration implements OnModuleInit {
  constructor(private readonly ggCards: GgCardRegistry) {}

  onModuleInit(): void {
    this.ggCards.register(
      VALHEIM_PLUGIN_ID,
      'valheim-year',
      valheimYearProducer,
      GG_PLUGIN_CARD_ORDER_BASE,
    );
  }
}
