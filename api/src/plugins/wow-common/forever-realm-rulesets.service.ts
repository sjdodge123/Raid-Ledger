import { Injectable, Logger } from '@nestjs/common';
import { WowForeverRealmRulesetsSchema } from '@raid-ledger/contract';
import type {
  AddonImportRulesetInferenceDto,
  WowForeverRealmRulesetsDto,
} from '@raid-ledger/contract';
import { SettingsService } from '../../settings/settings.service';
import type { DecodedAddonPaste } from './addon-import/addon-import.decoder';
import {
  buildRealmRulesetIndex,
  inferForPaste,
  sortRealmRulesets,
} from './forever-realm-rulesets.helpers';
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

  constructor(private readonly settings: SettingsService) {}

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
}
