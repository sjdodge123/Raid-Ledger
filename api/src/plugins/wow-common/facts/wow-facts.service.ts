import { Inject, Injectable, Logger } from '@nestjs/common';
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
 * Blizzard seam (H23): no Blizzard source ships yet. One registers through
 * {@link registerBlizzardSource} and is consulted only while the seam is
 * live: a source is registered AND `wow_forever_namespace_prefix` is set and
 * isn't the `classicforever` alias (the same test as
 * `forever-config.service.ts::namespacePrefixIsDefault`). That prefix check is
 * a PROXY for "the admin set the prefix after the ROK-1716 probe" — it is not
 * proof the probe currently reports the namespace live. Only while the seam
 * is live do blizzard facts get the fresh-window override
 * (`fact-precedence.ts` rule 2); otherwise blizzard-labelled facts (an
 * Armory-synced `characters` row) compete on newest `asOf` only.
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
    return this.sourcesFor(await this.isBlizzardSeamLive());
  }

  /**
   * Resolve facts for up to {@link MAX_ROSTER_ROWS} roster rows. Extra rows
   * are dropped, flagged `truncated` and logged once. One `load` (one query)
   * per active source.
   */
  async resolveFacts(
    refs: RosterCharRef[],
    now: Date = new Date(),
  ): Promise<ResolvedRosterResult> {
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
      const perSource: WowFactCandidates[] = loaded.flatMap((m) => {
        const c = m.get(ref.key);
        return c ? [c] : [];
      });
      facts.set(ref.key, resolveFacts(perSource, now, live));
    }
    return { facts, truncated };
  }

  /** Resolve every latest-snapshot roster row of one guild, keyed `m<memberId>`. */
  async resolveForGuild(
    guildId: number,
    now: Date = new Date(),
  ): Promise<ResolvedRosterResult> {
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

  /** The core sources, plus Blizzard while the seam is live. */
  private sourcesFor(blizzardLive: boolean): WowFactSource[] {
    const core: WowFactSource[] = [this.roster, this.addon, this.characterRows];
    return blizzardLive && this.blizzard ? [...core, this.blizzard] : core;
  }

  /** A Blizzard source is registered and the namespace prefix looks live. */
  private async isBlizzardSeamLive(): Promise<boolean> {
    return this.blizzard !== null && (await this.isForeverNamespaceLive());
  }

  private async isForeverNamespaceLive(): Promise<boolean> {
    const stored = await this.settings.get(WOW_FOREVER_NAMESPACE_PREFIX_KEY);
    return !!stored && stored !== FOREVER_NAMESPACE_ALIAS;
  }
}
