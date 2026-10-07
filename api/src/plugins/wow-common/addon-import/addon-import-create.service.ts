import { Inject, Injectable } from '@nestjs/common';
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
import { pasteSections } from './addon-import.paste-run';
import { parseImportRequest, rawFacts } from './addon-import.service.helpers';

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
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly characters: CharactersService,
    private readonly audit: AddonImportAuditService,
  ) {}

  async importNew(
    userId: number,
    body: unknown,
  ): Promise<AddonImportNewResultDto> {
    const facts = rawFacts(body);
    const outcome: AttemptOutcome = {
      userId,
      characterId: null,
      facts,
      result: 'ERROR',
      perSection: [],
    };
    try {
      const res = await this.attempt(userId, body, outcome);
      outcome.result = res.status;
      outcome.perSection = (res.sections ?? []).map((s) => s.status);
      outcome.characterId = res.target.characterId;
      return res;
    } catch (err) {
      if (err instanceof AddonImportError) outcome.result = err.code;
      throw err;
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
    return request.dryRun
      ? previewImport(this.db, input)
      : applyImport(this.db, this.characters, input);
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
    };
  }
}
