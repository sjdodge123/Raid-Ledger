import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import type * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EXTENSION_POINTS,
  type HubKindAdapter,
} from '../plugins/plugin-host/extension-points';
import { findGuildKind } from './guild-core.queries';

/**
 * ROK-1830: core's view of the per-kind hub adapters (`EXTENSION_POINTS.HUB_KIND`).
 * A kind whose owning plugin is inactive is refused with the same 403 that
 * `PluginActiveGuard` gives today, so "plugin off ⇒ no hub" still holds.
 */
@Injectable()
export class HubKindRegistry {
  constructor(
    private readonly plugins: PluginRegistryService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** The live adapter for `kind`, or undefined (unknown or owner inactive). */
  resolve(kind: GuildKind): HubKindAdapter | undefined {
    return this.plugins.getAdapter<HubKindAdapter>(
      EXTENSION_POINTS.HUB_KIND,
      kind,
    );
  }

  /** As `resolve`, but 403 when the owner is inactive and 404 when unknown. */
  require(kind: GuildKind): HubKindAdapter {
    const adapter = this.resolve(kind);
    if (adapter) return adapter;
    const owner = this.plugins.getSuspendedAdapterOwner(
      EXTENSION_POINTS.HUB_KIND,
      kind,
    );
    if (owner) {
      throw new ForbiddenException(`Plugin "${owner.pluginId}" is not active`);
    }
    throw new NotFoundException(`No hub module for kind "${kind}"`);
  }

  /** The live adapter for a guild's kind; undefined if no guild or inactive. */
  async forGuild(guildId: number): Promise<HubKindAdapter | undefined> {
    const kind = await findGuildKind(this.db, guildId);
    return kind === null ? undefined : this.resolve(kind);
  }

  /** Every live adapter (owner active), one per registered kind. */
  active(): HubKindAdapter[] {
    const registered =
      this.plugins.getAdaptersForExtensionPoint<HubKindAdapter>(
        EXTENSION_POINTS.HUB_KIND,
      );
    return [...registered.values()].filter(
      (a) => this.resolve(a.kind) !== undefined,
    );
  }
}
