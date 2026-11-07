import { Injectable, Logger } from '@nestjs/common';
import { WowForeverRealmRulesetsSchema } from '@raid-ledger/contract';
import type {
  AddonImportRulesetInferenceDto,
  WowForeverRealmRulesetsDto,
} from '@raid-ledger/contract';
import { SettingsService } from '../../settings/settings.service';
import type { DecodedAddonPaste } from './addon-import/addon-import.decoder';
import { resolveExportName } from './addon-import/addon-import.binding-name';
import {
  buildRealmRulesetIndex,
  inferForPaste,
  pasteLead,
  sortRealmRulesets,
} from './forever-realm-rulesets.helpers';
import { inferRulesetFromRealmName } from './forever-ruleset-inference.helpers';
import { ForeverRulesetLookupService } from './forever-ruleset-lookup.service';
import { WOW_FOREVER_REALM_RULESETS_KEY } from './forever.settings';

/** Parse the stored JSON; corrupt or schema-invalid = null. */
function parseStored(raw: string): WowForeverRealmRulesetsDto | null {
  try {
    const parsed = WowForeverRealmRulesetsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The admin-maintained WoW: Forever realm → ruleset map (ROK-1739 §5.3),
 * stored as ONE plugin-owned JSON setting. `SettingsService.get` is an
 * in-memory write-through cache, so a save is visible to the next import
 * with no extra invalidation. Reads never throw into an import.
 */
@Injectable()
export class ForeverRealmRulesetsService {
  private readonly logger = new Logger(ForeverRealmRulesetsService.name);
  /** The corrupt value last warned about — one warn per bad value, not per import. */
  private warnedCorrupt: string | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly lookup: ForeverRulesetLookupService,
  ) {}

  /** The stored map, sorted; absent or corrupt → no rows. */
  async getMap(): Promise<WowForeverRealmRulesetsDto> {
    const raw = await this.settings.get(WOW_FOREVER_REALM_RULESETS_KEY);
    if (!raw) return { entries: [] };
    const parsed = parseStored(raw);
    if (parsed) return parsed;
    if (this.warnedCorrupt !== raw) {
      this.warnedCorrupt = raw;
      this.logger.warn(
        'Stored WoW: Forever realm-ruleset map is corrupt; treating it as empty',
      );
    }
    return { entries: [] };
  }

  /** Whole-list replace (sorted); an empty list deletes the setting. */
  async saveMap(
    dto: WowForeverRealmRulesetsDto,
  ): Promise<WowForeverRealmRulesetsDto> {
    if (dto.entries.length === 0) {
      await this.settings.delete(WOW_FOREVER_REALM_RULESETS_KEY);
      return { entries: [] };
    }
    const sorted = sortRealmRulesets(dto);
    await this.settings.set(
      WOW_FOREVER_REALM_RULESETS_KEY,
      JSON.stringify(sorted),
    );
    return sorted;
  }

  /**
   * The map's ruleset for the paste's authoritative realm — null unless the
   * export's own ruleset is null and the realm is mapped. Never persisted.
   */
  async inferForPaste(
    paste: DecodedAddonPaste,
  ): Promise<AddonImportRulesetInferenceDto | null> {
    const { entries } = await this.getMap();
    return inferForPaste(paste, buildRealmRulesetIndex(entries));
  }

  /**
   * ROK-2100 — the CREATE resolution order for an export with a null
   * ruleset: 1 the admin realm map, 2 the Blizzard profile's ruleset, 3 the
   * realm name's tokens; null → `RULESET_REQUIRED` downstream (step 4). The
   * update path ignores steps 2–3 (`updateInferenceRuleset`, F8). The
   * lookup is cached, so running it for an update target is cheap (F9).
   */
  async resolveForPaste(
    paste: DecodedAddonPaste,
  ): Promise<AddonImportRulesetInferenceDto | null> {
    const mapped = await this.inferForPaste(paste);
    if (mapped) return mapped;
    const lead = pasteLead(paste);
    if (!lead || lead.who.ruleset !== null || !lead.region) return null;
    const realmName = lead.who.raw.realmName ?? '';
    const name = resolveExportName(lead.who);
    const fromBlizzard = await this.lookup.lookup(name, lead.region);
    if (fromBlizzard) {
      return { ruleset: fromBlizzard, realmName, source: 'blizzard' };
    }
    const fromName = inferRulesetFromRealmName(lead.who.raw.realmName);
    return fromName
      ? { ruleset: fromName, realmName, source: 'realm-name' }
      : null;
  }
}
