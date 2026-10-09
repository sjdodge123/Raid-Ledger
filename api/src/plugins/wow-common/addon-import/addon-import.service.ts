import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AddonImportRequestDto,
  AddonImportResultDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { CharactersService } from '../../../characters/characters.service';
import {
  ADDON_IMPORT_PENDING,
  AddonImportAuditService,
} from './addon-import.audit';
import type { AddonBindingResult } from './addon-import.binding';
import {
  decodeImportPaste,
  type DecodedAddonPaste,
} from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import {
  auditRow,
  finishAttempt,
  recordPasteFacts,
} from './addon-import.finish';
import {
  parseImportRequest,
  rawFacts,
  type AttemptFacts,
} from './addon-import.service.helpers';
import {
  bindPaste,
  loadImportCharacter,
  runForCharacter,
  type LoadedCharacter,
} from './addon-import.run';
import { WowItemMetaService } from '../wowhead-item/wow-item-meta.service';

/**
 * ROK-1724 §4.3 — owner check → limit (atomically reserves the audit row) →
 * size + schema → decode → bind (game, region, name, ruleset, GUID) → preview/apply in ONE
 * transaction → audit row finalised AFTER, outside the tx, on every outcome
 * incl. rejects (a `RATE_LIMITED` reject inserts its row then).
 * Never logs or stores the pasted string or its payload — only its sha256
 * and size.
 */
@Injectable()
export class AddonImportService {
  private readonly logger = new Logger(AddonImportService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly characters: CharactersService,
    private readonly audit: AddonImportAuditService,
    private readonly itemMeta: WowItemMetaService,
  ) {}

  async importString(
    userId: number,
    characterId: string,
    body: unknown,
  ): Promise<AddonImportResultDto> {
    // 404 / 403 for a missing or someone else's character — before anything
    // is audited against (or rate-limited on) a character the user can't see.
    await this.characters.findOne(userId, characterId);
    const facts = rawFacts(body);
    let result = 'ERROR';
    let perSection: string[] = [];
    try {
      const res = await this.attempt(userId, characterId, body, facts);
      result = res.status;
      perSection = (res.sections ?? []).map((s) => s.status);
      return res;
    } catch (err) {
      if (err instanceof AddonImportError) result = err.code;
      throw err;
    } finally {
      await this.finish(userId, characterId, facts, result, perSection);
    }
  }

  private async attempt(
    userId: number,
    characterId: string,
    body: unknown,
    facts: AttemptFacts,
  ): Promise<AddonImportResultDto> {
    // Limit FIRST (Codex P2): a user at the cap gets 429 even for a paste
    // that would 413/400 — `facts.dryRun` is read from the raw body, and the
    // schema only accepts a boolean, so it equals `request.dryRun` whenever
    // the parse below succeeds. A parse reject finalises the reserved row.
    facts.auditId = await this.audit.reserveAttempt(
      auditRow(userId, characterId, facts, ADDON_IMPORT_PENDING),
    );
    const request = parseImportRequest(body, facts);
    const paste = decodeImportPaste(request.importString);
    recordPasteFacts(facts, paste);
    const character = await loadImportCharacter(this.db, characterId);
    // Codex P2: bind EVERY section (the decoder also requires one exporter);
    // any section's reject rejects the whole paste before anything runs.
    const binding = bindPaste(paste, character, request);
    const res = await this.run(userId, character, paste, binding, request);
    // ROK-1727: AFTER the tx committed — fire-and-forget gear resolution.
    if (!request.dryRun) this.enqueueGear(paste, res);
    return res;
  }

  /**
   * Resolve the char section's gear item ids when that section applied.
   * Post-commit and best-effort: it must never fail an import that landed.
   */
  private enqueueGear(paste: DecodedAddonPaste, res: AddonImportResultDto) {
    try {
      const charStatus =
        res.sections?.find((s) => s.section === 'char')?.status ??
        (res.section === 'char' ? res.status : undefined);
      if (charStatus !== 'applied') return;
      const gear = paste.sections.char?.payload.data.gear ?? [];
      const ids = gear.flatMap((g) => (g.itemId ? [g.itemId] : []));
      if (ids.length > 0) this.itemMeta.enqueue(ids).catch((e) => this.warn(e));
    } catch (err: unknown) {
      this.warn(err);
    }
  }

  private warn(err: unknown): void {
    this.logger.warn(`Wowhead gear enqueue failed: ${String(err)}`);
  }

  /** Preview/apply every section + the binding's writes, in ONE tx. */
  private run(
    userId: number,
    character: LoadedCharacter,
    paste: DecodedAddonPaste,
    binding: AddonBindingResult,
    request: AddonImportRequestDto,
  ): Promise<AddonImportResultDto> {
    return this.db.transaction((tx) =>
      runForCharacter(tx, userId, character, paste, binding, request),
    );
  }

  private finish(
    userId: number,
    characterId: string,
    facts: AttemptFacts,
    result: string,
    perSection: string[],
  ): Promise<void> {
    return finishAttempt(this.audit, {
      userId,
      characterId,
      facts,
      result,
      perSection,
    });
  }
}
