import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PublicGuildCardParamsSchema,
  PublicGuildCardSchema,
  type GuildPublicCardSettings,
  type PublicGuildCard,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import { findGuildKind } from '../../../../guilds/guild-core.queries';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { WOW_COMMON_MANIFEST } from '../../manifest';
import {
  roundMemberCount,
  toPublicRecruitment,
} from './guild-public-card.helpers';
import {
  disablePublicCard,
  enablePublicCard,
  findCardSettings,
  findPublicCardRow,
  type Db,
  type PublicCardRow,
} from './guild-public-card.queries';

/** The ONE not-found every public miss returns (D2) — never leaks why. */
export const PUBLIC_CARD_NOT_FOUND = 'Not found';

/**
 * ROK-1813 — the opt-in public visitor card of a WoW guild. `read` serves
 * signed-out visitors (controller unguarded): every miss — malformed or
 * unknown slug, card off, hub hidden, not `wow_guild`, plugin inactive,
 * guild deleted — is the same 404 (D2). Settings are `canEdit`-only via
 * `GuildEditorGuard` on the controller; this service checks the kind.
 */
@Injectable()
export class GuildPublicCardService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly plugins: PluginRegistryService,
  ) {}

  /** The public DTO behind `slug`, strict-parsed (D5); 404 otherwise. */
  async read(slug: string): Promise<PublicGuildCard> {
    const params = PublicGuildCardParamsSchema.safeParse({ slug });
    if (!params.success || !this.wowActive()) throw notFound();
    const row = await findPublicCardRow(this.db, params.data.slug);
    if (!row) throw notFound();
    return PublicGuildCardSchema.strict().parse(toPublicCard(row));
  }

  /** `{enabled, slug}` for the editor section. */
  async getSettings(guildId: number): Promise<GuildPublicCardSettings> {
    await this.assertWowGuild(guildId);
    return findCardSettings(this.db, guildId);
  }

  /** Switch the card on (slug minted once, kept across off/on) or off. */
  async setEnabled(
    guildId: number,
    enabled: boolean,
  ): Promise<GuildPublicCardSettings> {
    await this.assertWowGuild(guildId);
    return enabled
      ? enablePublicCard(this.db, guildId)
      : disablePublicCard(this.db, guildId);
  }

  private wowActive(): boolean {
    return this.plugins.getActiveSlugsSync().has(WOW_COMMON_MANIFEST.id);
  }

  private async assertWowGuild(guildId: number): Promise<void> {
    if ((await findGuildKind(this.db, guildId)) !== 'wow_guild') {
      throw new NotFoundException('Guild not found');
    }
  }
}

function notFound(): NotFoundException {
  return new NotFoundException(PUBLIC_CARD_NOT_FOUND);
}

/** Row → the D5 fields and nothing else. Realm-less (Forever) guilds → `realmName: null`. */
export function toPublicCard(row: PublicCardRow): PublicGuildCard {
  return {
    name: row.name,
    region: row.region,
    realmName: row.realmSlug === null ? null : (row.rawRealm ?? row.realmSlug),
    gameName: row.gameName,
    approxMemberCount: roundMemberCount(row.memberCount),
    recruitment: toPublicRecruitment(row.recruitment),
  };
}
