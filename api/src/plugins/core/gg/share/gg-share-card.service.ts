/**
 * ROK-2187 lane 7 — the public share PNG + crawler OG page for `/w/:slug`.
 *
 * Cache: an in-process LRU (v1) keyed by `(slug, computed_at)`. The snapshot
 * is frozen, so a key's bytes never change; a revoked/rotated slug never
 * reaches the cache because every request re-runs the public lookup first
 * (unshared / rotated / deactivated owner → `null` → 404). Media-store
 * persistence was skipped for v1: a re-render after a restart costs ~100 ms.
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GgPublicSummaryDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { buildOgHtmlPage } from '../../../../lineups/public-lineup-og.service';
import { SettingsService } from '../../../../settings/settings.service';
import { toGgPublicSummary } from '../gg-dto.helpers';
import { findGgPublic } from '../gg-snapshot.queries';
import { renderGgShareCardPng } from './gg-share-card.render';

/** A rendered share card and its strong ETag. */
export interface GgShareCardPng {
  png: Buffer;
  etag: string;
}

const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_CACHED = 64;

@Injectable()
export class GgShareCardService {
  private readonly cache = new Map<string, GgShareCardPng>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  /** The share PNG for `slug`, or `null` when it is not (or no longer) shared. */
  async png(slug: string): Promise<GgShareCardPng | null> {
    const found = await this.lookup(slug);
    if (!found) return null;
    const key = `${slug}:${found.computedAt.toISOString()}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const png = await renderGgShareCardPng(found.dto);
    const card = {
      png,
      etag: `"${createHash('sha256').update(png).digest('hex').slice(0, 32)}"`,
    };
    this.remember(key, card);
    return card;
  }

  /** Crawler HTML with og:title/description/image; a generic card for unknown slugs. */
  async ogHtml(slug: string, requestOrigin: string): Promise<string> {
    const clientUrl =
      (await this.settings.getTrustedClientUrl()) ?? requestOrigin;
    const enc = encodeURIComponent(slug);
    const url = `${clientUrl}/w/${enc}`;
    const found = await this.lookup(slug);
    if (!found) {
      const description =
        'A year of games, events and good company on Raid Ledger.';
      return buildOgHtmlPage({
        title: 'GG — Raid Ledger',
        description,
        url,
        imageUrl: null,
      });
    }
    const { dto } = found;
    return buildOgHtmlPage({
      title: `${dto.displayName}'s GG ${dto.year}`,
      description: ogDescription(dto),
      url,
      imageUrl: `${clientUrl}/api/gg/public/${enc}/card.png`,
    });
  }

  private async lookup(
    slug: string,
  ): Promise<{ dto: GgPublicSummaryDto; computedAt: Date } | null> {
    if (!SLUG_RE.test(slug)) return null;
    const row = await findGgPublic(this.db, slug);
    const dto = row ? toGgPublicSummary(row) : null;
    return row && dto ? { dto, computedAt: row.computedAt } : null;
  }

  private remember(key: string, card: GgShareCardPng): void {
    this.cache.set(key, card);
    const oldest = this.cache.keys().next();
    if (this.cache.size > MAX_CACHED && !oldest.done)
      this.cache.delete(oldest.value);
  }
}

/** "42 events · 380h played · played with 17 people" — counts only. */
function ogDescription(dto: GgPublicSummaryDto): string {
  const hours = Math.round(dto.hoursPlayedSeconds / 3600);
  return `${dto.eventsAttended} events · ${hours}h played · played with ${dto.playedWithCount} people`;
}
