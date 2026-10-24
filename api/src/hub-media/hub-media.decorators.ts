import { Injectable } from '@nestjs/common';
import type { HubMediaItem } from '@raid-ledger/contract';
import type { HubMediaRow } from '../drizzle/schema';

/** A source's own link for an item, e.g. ROK-1941/1931 "Show on map" (D9). */
export type HubMediaDecorator = (row: HubMediaRow) => HubMediaItem['link'];

/**
 * ROK-1942 D9 — source-specific display stays server-side: a source module
 * registers a decorator; the first non-null link wins. v1 registers none,
 * so the widget never needs source-specific code.
 */
@Injectable()
export class HubMediaDecoratorRegistry {
  private readonly decorators: HubMediaDecorator[] = [];

  register(decorator: HubMediaDecorator): void {
    this.decorators.push(decorator);
  }

  linkFor(row: HubMediaRow): HubMediaItem['link'] {
    for (const decorate of this.decorators) {
      const link = decorate(row);
      if (link) return link;
    }
    return null;
  }
}
