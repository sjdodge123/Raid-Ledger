/**
 * ROK-1813 — the opt-in public visitor card behind `/p/guild/:slug` —
 * INTENTIONALLY UNGUARDED (signed-out visitors; no JWT, no
 * `PluginActiveGuard`, whose 403 would leak that the route exists — the
 * service 404s when wow-common is inactive instead). Returns the
 * `PublicGuildCardSchema` allow-list only: no id, member, editor, rank,
 * note or link. Every miss is the same 404 (D2). `noindex` + `no-store` go
 * on every response, 404s included, so "off" is instant behind a CDN.
 */
import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PublicGuildCard } from '@raid-ledger/contract';
import { RateLimit } from '../../../../throttler/rate-limit.decorator';
import { GuildPublicCardService } from './guild-public-card.service';

export const PUBLIC_CARD_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
} as const;

@Controller('plugins/wow/public-guild-cards')
@RateLimit('public')
export class PublicGuildCardController {
  constructor(private readonly cards: GuildPublicCardService) {}

  /** `GET /plugins/wow/public-guild-cards/:slug` → `PublicGuildCard`. */
  @Get(':slug')
  read(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicGuildCard> {
    for (const [name, value] of Object.entries(PUBLIC_CARD_HEADERS)) {
      res.setHeader(name, value);
    }
    return this.cards.read(slug);
  }
}
