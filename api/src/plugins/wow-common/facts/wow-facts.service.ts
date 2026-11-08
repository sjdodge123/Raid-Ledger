import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { isForeverArmoryImportEnabled } from '../forever-armory-switch';
import {
  FOREVER_NAMESPACE_ALIAS,
  getForeverNamespacePrefix,
} from '../forever-namespace.resolver';
import { loadRosterRows } from '../guilds/guild-roster.helpers';
import { AddonSnapshotFactSource } from './addon-snapshot.fact-source';
import { BlizzardForeverFactSource } from './blizzard-forever.fact-source';
import { CharacterRowFactSource } from './character-row.fact-source';
import { resolveFacts } from './fact-precedence';
import { dropShadowedBlizzard } from './fact-source.helpers';
import { RosterFactSource } from './roster.fact-source';
import {
  MAX_ROSTER_ROWS,
  type ResolvedWowFacts,
  type RosterCharRef,
  type RosterKey,
  type WowFactCandidates,
  type WowFactSource,
} from './wow-fact.types';

type LoadedMap = Map<RosterKey, WowFactCandidates>;

/** Resolved facts per roster key. */
export type ResolvedRoster = Map<RosterKey, ResolvedWowFacts>;

/** One resolve call's result. */
export interface ResolvedRosterResult {
  facts: ResolvedRoster;
  /** True when rows past {@link MAX_ROSTER_ROWS} were dropped (H5 surfaces it). */
  truncated: boolean;
}

/**
 * ROK-1910 — runs every active {@link WowFactSource} once per batch and
 * resolves each roster row through the per-field precedence table.
 *
 * Blizzard seam (H23, flipped by ROK-1920): {@link BlizzardForeverFactSource}
 * registers itself through {@link registerBlizzardSource} at construction and
 * is consulted only while the seam is live: a source is registered AND the
 * EFFECTIVE Forever namespace prefix (`getForeverNamespacePrefix()`, hydrated
 * from the stored setting by `ForeverConfigService.onModuleInit` and on every
 * admin change) is not the `classicforever` alias AND the Forever Armory kill
 * switch is on. Keying on the effective prefix rather than the STORED
 * override `wow_forever_namespace_prefix` resolves ROK-2102 FLAG A1: since
 * ROK-2102 the effective prefix defaults to `forever` with the key absent, so
 * a stored-override test would keep the seam off on a default install. It is
 * not proof the probe currently reports the namespace live. Only while it is
 * live does the Blizzard source run and shadow the row source's
 * blizzard-labelled copies of the same fields. Whether or not it is live, any
 * blizzard fact — including an Armory-synced `characters` row's — wins
 * regardless of age (`fact-precedence.ts` rule 2, ROK-2138 OQ-1); addon and
 * roster facts only fill fields Blizzard has no value for.
 */
@Injectable()
export class WowFactsService {
  private readonly logger = new Logger(WowFactsService.name);
  private blizzard: WowFactSource | null = null;

  constructor(
    private readonly roster: RosterFactSource,
    private readonly addon: AddonSnapshotFactSource,
    private readonly characterRows: CharacterRowFactSource,
    private readonly settings: SettingsService,
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional() blizzardForever?: BlizzardForeverFactSource,
  ) {
    if (blizzardForever) this.registerBlizzardSource(blizzardForever);
  }

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
    return this.sourcesFor(await this.isBlizzardSeamLive());
  }

  /**
   * Resolve facts for up to {@link MAX_ROSTER_ROWS} roster rows. Extra rows
   * are dropped, flagged `truncated` and logged once. One `load` (one query)
   * per active source.
   */
  async resolveFacts(refs: RosterCharRef[]): Promise<ResolvedRosterResult> {
    const truncated = refs.length > MAX_ROSTER_ROWS;
    if (truncated) {
      this.logger.warn(
        `Fact resolve capped at ${MAX_ROSTER_ROWS} of ${refs.length} roster rows`,
      );
    }
    const batch = refs.slice(0, MAX_ROSTER_ROWS);
    const live = await this.isBlizzardSeamLive();
    const sources = this.sourcesFor(live);
    const loaded = await Promise.all(sources.map((s) => s.load(batch)));
    const facts: ResolvedRoster = new Map();
    for (const ref of batch) {
      const perSource = this.candidatesFor(ref.key, sources, loaded);
      facts.set(ref.key, resolveFacts(perSource));
    }
    return { facts, truncated };
  }

  /** Resolve every latest-snapshot roster row of one guild, keyed `m<memberId>`. */
  async resolveForGuild(guildId: number): Promise<ResolvedRosterResult> {
    return this.resolveFacts(await this.guildRefs(guildId));
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

  /** The core sources, plus Blizzard while the seam is live. */
  private sourcesFor(blizzardLive: boolean): WowFactSource[] {
    const core: WowFactSource[] = [this.roster, this.addon, this.characterRows];
    return blizzardLive && this.blizzard ? [...core, this.blizzard] : core;
  }

  /**
   * Every source's candidates for one roster row; the row source's
   * blizzard-labelled copies give way to the Blizzard source's own facts.
   */
  private candidatesFor(
    key: RosterKey,
    sources: WowFactSource[],
    loaded: LoadedMap[],
  ): WowFactCandidates[] {
    const blizzardAt = this.blizzard ? sources.indexOf(this.blizzard) : -1;
    const blizzard = blizzardAt >= 0 ? loaded[blizzardAt]?.get(key) : undefined;
    const rowsAt = sources.indexOf(this.characterRows);
    return loaded.flatMap((m, i) => {
      const c = m.get(key);
      if (!c) return [];
      return [i === rowsAt ? dropShadowedBlizzard(c, blizzard) : c];
    });
  }

  /** A Blizzard source is registered and the Forever namespace is live. */
  private async isBlizzardSeamLive(): Promise<boolean> {
    return this.blizzard !== null && (await this.isForeverNamespaceLive());
  }

  /** Effective prefix is past the alias AND the Armory kill switch is on. */
  private async isForeverNamespaceLive(): Promise<boolean> {
    if (getForeverNamespacePrefix() === FOREVER_NAMESPACE_ALIAS) return false;
    return isForeverArmoryImportEnabled(this.settings);
  }
}
