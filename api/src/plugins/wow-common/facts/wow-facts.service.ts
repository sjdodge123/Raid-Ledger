import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { FOREVER_NAMESPACE_ALIAS } from '../forever-namespace.resolver';
import { WOW_FOREVER_NAMESPACE_PREFIX_KEY } from '../forever.settings';
import { loadRosterRows } from '../guilds/guild-roster.helpers';
import { AddonSnapshotFactSource } from './addon-snapshot.fact-source';
import { CharacterRowFactSource } from './character-row.fact-source';
import { resolveFacts } from './fact-precedence';
import { RosterFactSource } from './roster.fact-source';
import {
  MAX_ROSTER_ROWS,
  type ResolvedWowFacts,
  type RosterCharRef,
  type RosterKey,
  type WowFactCandidates,
  type WowFactSource,
} from './wow-fact.types';

/** Resolved facts per roster key. */
export type ResolvedRoster = Map<RosterKey, ResolvedWowFacts>;

/**
 * ROK-1910 — runs every active {@link WowFactSource} once per batch and
 * resolves each roster row through the per-field precedence table.
 *
 * Blizzard seam (H23): no Blizzard source ships yet. One registers through
 * {@link registerBlizzardSource} and is consulted only while the admin has
 * set a real Forever namespace (`wow_forever_namespace_prefix` ≠ the
 * `classicforever` alias, ROK-1716/1717).
 */
@Injectable()
export class WowFactsService {
  private blizzard: WowFactSource | null = null;

  constructor(
    private readonly roster: RosterFactSource,
    private readonly addon: AddonSnapshotFactSource,
    private readonly characterRows: CharacterRowFactSource,
    private readonly settings: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Register the Blizzard source (once the Forever namespace is live).
   * @throws Error when the source does not answer as `blizzard`.
   */
  registerBlizzardSource(source: WowFactSource): void {
    if (source.id !== 'blizzard') {
      throw new Error(`Expected a blizzard fact source, got ${source.id}`);
    }
    this.blizzard = source;
  }

  /** The sources a resolve consults right now. */
  async activeSources(): Promise<WowFactSource[]> {
    const core: WowFactSource[] = [this.roster, this.addon, this.characterRows];
    if (this.blizzard && (await this.isForeverNamespaceLive())) {
      return [...core, this.blizzard];
    }
    return core;
  }

  /**
   * Resolve facts for up to {@link MAX_ROSTER_ROWS} roster rows (extra rows
   * are dropped). One `load` (one query) per active source.
   */
  async resolveFacts(
    refs: RosterCharRef[],
    now: Date = new Date(),
  ): Promise<ResolvedRoster> {
    const batch = refs.slice(0, MAX_ROSTER_ROWS);
    const sources = await this.activeSources();
    const loaded = await Promise.all(sources.map((s) => s.load(batch)));
    const out: ResolvedRoster = new Map();
    for (const ref of batch) {
      const perSource: WowFactCandidates[] = loaded.flatMap((m) => {
        const c = m.get(ref.key);
        return c ? [c] : [];
      });
      out.set(ref.key, resolveFacts(perSource, now));
    }
    return out;
  }

  /** Resolve every latest-snapshot roster row of one guild, keyed `m<memberId>`. */
  async resolveForGuild(
    guildId: number,
    now: Date = new Date(),
  ): Promise<ResolvedRoster> {
    return this.resolveFacts(await this.guildRefs(guildId), now);
  }

  /** The guild's roster rows as refs (first linked character per member). */
  async guildRefs(guildId: number): Promise<RosterCharRef[]> {
    const refs = new Map<RosterKey, RosterCharRef>();
    for (const row of await loadRosterRows(this.db, guildId)) {
      const key = `m${row.memberId}`;
      if (refs.has(key)) continue;
      refs.set(key, {
        key,
        memberId: row.memberId,
        characterId: row.characterId,
      });
    }
    return [...refs.values()];
  }

  private async isForeverNamespaceLive(): Promise<boolean> {
    const stored = await this.settings.get(WOW_FOREVER_NAMESPACE_PREFIX_KEY);
    return !!stored && stored !== FOREVER_NAMESPACE_ALIAS;
  }
}
