import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { WowForeverRuleset, WowRegion } from '@raid-ledger/contract';
import { SettingsService } from '../../settings/settings.service';
import { SETTINGS_EVENTS } from '../../settings/settings.types';
import { BlizzardService } from './blizzard.service';
import type { ForeverRulesetFetchOutcome } from './blizzard-forever-ruleset.fetch';
import { isForeverArmoryImportEnabled } from './forever-armory-switch';
import { rulesetFromBlizzard } from './forever-ruleset-inference.helpers';

/** F5: hard budget for token + profile on an upload's ruleset lookup. */
export const RULESET_LOOKUP_BUDGET_MS = 1500;
/** F6: a resolved ruleset is remembered a day. */
export const RULESET_HIT_TTL_MS = 24 * 60 * 60 * 1000;
/** F6: a miss (404/403/unmapped) is remembered an hour — a fresh level 10 resolves the same evening. */
export const RULESET_MISS_TTL_MS = 60 * 60 * 1000;
/** Cache cap; the oldest entry is dropped first. */
export const RULESET_CACHE_MAX = 2000;

interface CacheEntry {
  ruleset: WowForeverRuleset | null;
  until: number;
}

/**
 * ROK-2100 step 2 — a WoW: Forever character's ruleset from the realmless
 * Battle.net profile. Gated on a configured Blizzard integration AND the
 * Forever Armory switch; bounded by {@link RULESET_LOOKUP_BUDGET_MS}; cached
 * per `${region}:${lower(name)}`. `lookup` never throws.
 */
@Injectable()
export class ForeverRulesetLookupService {
  private readonly logger = new Logger(ForeverRulesetLookupService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly settings: SettingsService,
    private readonly blizzard: BlizzardService,
  ) {}

  /** New credentials may see different characters — forget everything. */
  @OnEvent(SETTINGS_EVENTS.BLIZZARD_UPDATED)
  clearCache(): void {
    this.cache.clear();
  }

  /** The Blizzard-reported ruleset, or null (off, miss, timeout, unknown shape). */
  async lookup(
    name: string,
    region: WowRegion,
  ): Promise<WowForeverRuleset | null> {
    const key = `${region}:${name.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.ruleset;
    if (!(await this.enabled())) return null;
    const outcome = await this.fetchWithinBudget(name, region);
    if (outcome.kind === 'error') return null;
    const ruleset =
      outcome.kind === 'found'
        ? rulesetFromBlizzard(outcome.ruleset, (m) => this.logger.warn(m))
        : null;
    this.remember(key, ruleset);
    return ruleset;
  }

  private async enabled(): Promise<boolean> {
    if ((await this.settings.getBlizzardConfig()) === null) return false;
    return isForeverArmoryImportEnabled(this.settings);
  }

  /** Token + profile raced against one abortable budget timer. */
  private async fetchWithinBudget(
    name: string,
    region: WowRegion,
  ): Promise<ForeverRulesetFetchOutcome> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<ForeverRulesetFetchOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        this.logger.warn('Forever ruleset lookup exceeded its budget');
        resolve({ kind: 'error' });
      }, RULESET_LOOKUP_BUDGET_MS);
    });
    const call = this.blizzard
      .fetchForeverRulesetRaw(name, region, controller.signal)
      .catch((): ForeverRulesetFetchOutcome => ({ kind: 'error' }));
    try {
      return await Promise.race([call, budget]);
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(key: string, ruleset: WowForeverRuleset | null): void {
    const ttl = ruleset === null ? RULESET_MISS_TTL_MS : RULESET_HIT_TTL_MS;
    this.cache.delete(key);
    this.cache.set(key, { ruleset, until: Date.now() + ttl });
    if (this.cache.size <= RULESET_CACHE_MAX) return;
    const oldest = this.cache.keys().next();
    if (!oldest.done) this.cache.delete(oldest.value);
  }
}
