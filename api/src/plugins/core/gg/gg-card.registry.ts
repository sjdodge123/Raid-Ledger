import { Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GG_CORE_CARD_IDS,
  parseGgCardPayload,
  type GgCardEnvelope,
  type GgCoreCardId,
} from '@raid-ledger/contract';
import type * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

/** The GG year as an instant range in the community tz: `[start, end)`. */
export interface GgCardWindow {
  start: Date;
  end: Date;
}

/** Everything a GG card producer gets to compute one user's card. */
export interface GgCardContext {
  db: PostgresJsDatabase<typeof schema>;
  userId: number;
  year: number;
  window: GgCardWindow;
  /** The community IANA timezone the window was cut in. */
  tz: string;
}

/** Computes one user's card payload; `null` = the card is omitted. */
export type GgCardProducer = (ctx: GgCardContext) => Promise<unknown>;

/** Plugin cards sit between Core `hubs` (1000) and `superlative` (1200). */
export const GG_PLUGIN_CARD_ORDER_BASE = 1100;

/** Core card order: 1–10 → 100…1000, then the plugin band, then 1200/1300. */
export function ggCoreCardOrder(id: GgCoreCardId): number {
  const i = GG_CORE_CARD_IDS.indexOf(id);
  return (i < 10 ? i + 1 : i + 2) * 100;
}

interface OwnedProducer {
  ownerPluginId: string;
  cardId: string;
  order: number;
  produce: GgCardProducer;
}

/**
 * ROK-2187 R3 — the GG <year> card registry. Each plugin (Core included)
 * registers one producer per card it declared as a `gg-card` behaviour in
 * `HUB_PLUGIN_MANIFESTS`; the ownership guard scans
 * `this.<field>.register(owner, '<cardId>', …)` on a field typed
 * `GgCardRegistry`. Shaped like `HubMediaDecoratorRegistry`: a producer
 * whose owner plugin is inactive is never run.
 */
@Injectable()
export class GgCardRegistry {
  private readonly logger = new Logger(GgCardRegistry.name);
  private readonly producers: OwnedProducer[] = [];

  constructor(private readonly plugins: PluginRegistryService) {}

  /** Register `produce` for card `cardId` of `ownerPluginId`, at story `order`. */
  register(
    ownerPluginId: string,
    cardId: string,
    produce: GgCardProducer,
    order: number,
  ): void {
    const taken = this.producers.some(
      (p) => p.ownerPluginId === ownerPluginId && p.cardId === cardId,
    );
    if (taken) {
      throw new Error(
        `GG card "${ownerPluginId}/${cardId}" is already registered`,
      );
    }
    this.producers.push({ ownerPluginId, cardId, order, produce });
  }

  /**
   * Every active plugin's card for `ctx`, payload-validated, in story order.
   * A null, invalid or throwing producer drops only its own card.
   */
  async produceAll(ctx: GgCardContext): Promise<GgCardEnvelope[]> {
    const active = this.producers.filter((p) =>
      this.plugins.isActive(p.ownerPluginId),
    );
    const cards = await Promise.all(active.map((p) => this.produce(p, ctx)));
    return cards
      .flatMap((c) => (c === null ? [] : [c]))
      .sort((a, b) => a.order - b.order);
  }

  private async produce(
    p: OwnedProducer,
    ctx: GgCardContext,
  ): Promise<GgCardEnvelope | null> {
    const key = `${p.ownerPluginId}/${p.cardId}`;
    let payload: unknown;
    try {
      payload = await p.produce(ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`GG card ${key} failed for user ${ctx.userId}: ${msg}`);
      return null;
    }
    if (payload === null) return null;
    const card = {
      pluginSlug: p.ownerPluginId,
      cardId: p.cardId,
      order: p.order,
      payload,
    };
    const parsed = parseGgCardPayload(card);
    if (parsed === null) {
      this.logger.warn(`GG card ${key} payload failed its schema; skipped`);
      return null;
    }
    return { ...card, payload: parsed };
  }
}
