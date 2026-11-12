import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AddonImportNewRequestSchema,
  type AddonImportNewRequestDto,
  type AddonImportNewResultDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { CharactersService } from '../../../characters/characters.service';
import {
  ADDON_IMPORT_PENDING,
  AddonImportAuditService,
} from './addon-import.audit';
import { authoritativeSectionIndex } from './addon-import.binding-paste';
import { resolveExportName } from './addon-import.binding-name';
import {
  applyImport,
  previewImport,
  type CreateImportInput,
} from './addon-import-create.apply';
import { foreverGameId, regionFromExport } from './addon-import-create.helpers';
import {
  decodeImportPaste,
  type DecodedAddonPaste,
} from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import {
  auditRow,
  finishAttempt,
  recordPasteFacts,
  type AttemptOutcome,
} from './addon-import.finish';
import {
  RosterInsightsCache,
  invalidateRosterInsights,
} from '../guilds/roster-insights/roster-insights.cache';
import { pasteSections } from './addon-import.paste-run';
import { enqueueAppliedGear } from './addon-import.gear-enqueue';
import { WowItemMetaService } from '../wowhead-item/wow-item-meta.service';
import {
  parseImportRequest,
  rawFacts,
  withRulesetInference,
} from './addon-import.service.helpers';
import { ForeverRealmRulesetsService } from '../forever-realm-rulesets.service';
import { flagIfRosterChanged } from './addon-import-guild.flag';
import { readRaidPullScope } from './addon-import-raid.scope';
import { ForeverAutoLinkService } from '../forever-auto-link/forever-auto-link.service';
import { nudgeAutoLink } from './addon-import.autolink-nudge';
import type { PullScope } from '../guilds/roster-insights/roster-insights.pull-scope';

/** How `importNew` runs its post-import housekeeping. */
export interface ImportNewOptions {
  /**
   * ROK-2179: the companion path acks (202) without waiting for the roster
   * insights invalidation, the roster-change flag and the audit finalise —
   * they run after, logged (never thrown) on failure. The reserved audit row
   * stays PENDING meanwhile and already counts against the limit. The paste
   * route leaves this off and awaits them, as before.
   */
  deferHousekeeping?: boolean;
}

/**
 * ROK-1738 — `POST /plugins/wow/characters/addon-import`: import a
 * LedgerLink export WITHOUT a character id. Same order as the per-character
 * route: limit FIRST (reserves the audit row, `characterId` null — the same
 * per-user 20/60 budget) → size + schema → decode → resolve the target from
 * the AUTHORITATIVE section's `who` → preview (D11) or apply (D4) → audit row
 * finalised AFTER the tx with the created/updated id (D8), on every outcome.
 */
@Injectable()
export class AddonImportCreateService {
  private readonly logger = new Logger(AddonImportCreateService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly characters: CharactersService,
    private readonly audit: AddonImportAuditService,
    private readonly itemMeta: WowItemMetaService,
    private readonly realmRulesets: ForeverRealmRulesetsService,
    private readonly insightsCache: RosterInsightsCache,
    private readonly autoLink: ForeverAutoLinkService,
  ) {}

  async importNew(
    userId: number,
    body: unknown,
    opts: ImportNewOptions = {},
  ): Promise<AddonImportNewResultDto> {
    const outcome: AttemptOutcome = {
      userId,
      characterId: null,
      facts: rawFacts(body),
      result: 'ERROR',
      perSection: [],
    };
    let applied: AddonImportNewResultDto | null = null;
    try {
      const res = await this.attempt(userId, body, outcome);
      outcome.result = res.status;
      outcome.perSection = (res.sections ?? []).map((s) => s.status);
      outcome.characterId = res.target.characterId;
      if (!outcome.facts.dryRun) applied = res;
      return res;
    } catch (err) {
      if (err instanceof AddonImportError) outcome.result = err.code;
      throw err;
    } finally {
      await this.settle(this.housekeep(outcome, applied), userId, opts);
    }
  }

  /** Awaits the housekeeping, or (deferred) detaches it with a log on failure. */
  private async settle(
    done: Promise<void>,
    userId: number,
    opts: ImportNewOptions,
  ): Promise<void> {
    if (opts.deferHousekeeping !== true) return done;
    void done.catch((err: unknown) => {
      this.logger.warn(
        `addon-import housekeeping failed userId=${userId}: ${String(err)}`,
      );
    });
  }

  /**
   * AFTER the tx committed (ROK-1913: with the created/updated id — a
   * create's id only exists once `attempt` resolved), on every outcome: the
   * applied import's follow-ups, then the audit row(s) finalised.
   */
  private async housekeep(
    outcome: AttemptOutcome,
    applied: AddonImportNewResultDto | null,
  ): Promise<void> {
    try {
      if (applied) {
        const { characterId } = applied.target;
        await this.afterApply(characterId, readRaidPullScope(applied));
        // ROK-2066: a wholesale roster change applied — tell staff.
        await flagIfRosterChanged(
          this.db,
          outcome.userId,
          applied,
          this.logger,
        );
      }
    } finally {
      await finishAttempt(this.audit, outcome);
    }
  }

  private async attempt(
    userId: number,
    body: unknown,
    outcome: AttemptOutcome,
  ): Promise<AddonImportNewResultDto> {
    const { facts } = outcome;
    // Limit FIRST (as the per-character route): a capped user gets 429 even
    // for a paste that would 413/400; a parse reject finalises the row.
    facts.auditId = await this.audit.reserveAttempt(
      auditRow(userId, null, facts, ADDON_IMPORT_PENDING),
    );
    const request = parseImportRequest(
      body,
      facts,
      AddonImportNewRequestSchema,
    );
    const paste = decodeImportPaste(request.importString);
    recordPasteFacts(facts, paste);
    const input = await this.buildInput(userId, paste, request);
    // An update target's id is audited even when the run then throws.
    input.onTarget = (id) => {
      outcome.characterId = id;
    };
    const run = request.dryRun
      ? previewImport(this.db, input)
      : applyImport(this.db, this.characters, input);
    // ROK-1739 D7: the inference rides on preview AND apply, never persisted.
    const res = withRulesetInference(await run, input.inference);
    // ROK-1727: AFTER the tx committed — fire-and-forget gear resolution.
    if (!request.dryRun) {
      enqueueAppliedGear(this.itemMeta, paste, res, this.logger);
    }
    return res;
  }

  /** ROK-1913: the imported character's guilds' roster insights are stale. */
  private afterApply(
    characterId: string | null,
    pullScope: PullScope | undefined,
  ): Promise<void> {
    // ROK-2124: try the Forever Armory auto-link now (fire-and-forget).
    nudgeAutoLink(this.autoLink, characterId, this.logger);
    return invalidateRosterInsights(
      this.insightsCache,
      characterId,
      this.logger,
      pullScope,
    );
  }

  /** Region, name and GUID from the AUTHORITATIVE section (ruling Q7). */
  private async buildInput(
    userId: number,
    paste: DecodedAddonPaste,
    request: AddonImportNewRequestDto,
  ): Promise<CreateImportInput> {
    const payloads = pasteSections(paste).map((s) => s.payload);
    const lead = payloads[authoritativeSectionIndex(payloads)];
    if (!lead) throw new AddonImportError('BAD_HEADER');
    const region = regionFromExport(lead.client.region);
    const gameId = await foreverGameId(this.db);
    const { who } = lead;
    const name = resolveExportName(who);
    return {
      userId,
      paste,
      request,
      who,
      query: { userId, gameId, region, guid: who.guid, name },
      // ROK-2100: map → Blizzard → realm name (create-only beyond the map).
      inference: await this.realmRulesets.resolveForPaste(paste),
    };
  }
}
