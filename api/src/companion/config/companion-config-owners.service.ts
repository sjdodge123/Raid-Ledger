/**
 * ROK-2067 D1/D13 — the owner plugin (`plugin`) and its game (`game`) of a
 * `/config` contract. Plugin state is a sync cache read (D2); the game is one
 * `games` query per owner per call.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  hubManifestFor,
  type CompanionConfigGame,
  type CompanionConfigPlugin,
} from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import {
  loadConfigGameRows,
  pickConfigGame,
} from './companion-config-game.helpers';

/** The hub manifest's game slugs for `pluginId` (its first is the primary). */
function hubGameSlugs(pluginId: string): readonly string[] {
  return hubManifestFor(pluginId)?.gameSlugs ?? [];
}

@Injectable()
export class CompanionConfigOwners {
  constructor(
    private readonly plugins: PluginRegistryService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** `{id, name, state}`; `null` when no owner is known. */
  plugin(ownerId: string | undefined): CompanionConfigPlugin | null {
    if (ownerId === undefined) return null;
    return {
      id: ownerId,
      name: this.plugins.getManifest(ownerId)?.name ?? ownerId,
      state: this.plugins.getPluginState(ownerId),
    };
  }

  /** The D13 pick among the owner's game slugs; `null` = no `games` row. */
  async game(ownerId: string | undefined): Promise<CompanionConfigGame | null> {
    if (ownerId === undefined) return null;
    const hubSlugs = hubGameSlugs(ownerId);
    const slugs = this.plugins.getManifest(ownerId)?.gameSlugs ?? hubSlugs;
    const rows = await loadConfigGameRows(this.db, slugs);
    return pickConfigGame(slugs, hubSlugs[0] ?? slugs[0], rows);
  }
}
