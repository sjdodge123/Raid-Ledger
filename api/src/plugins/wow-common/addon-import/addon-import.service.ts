import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AddonImportRequestDto,
  AddonImportResultDto,
  WowRegion,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { CharactersService } from '../../../characters/characters.service';
import type { AddonImportAuditInsert } from '../../../drizzle/schema';
import {
  ADDON_IMPORT_PENDING,
  AddonImportAuditService,
} from './addon-import.audit';
import {
  bindToCharacter,
  type AddonBindingCharacter,
  type AddonBindingResult,
} from './addon-import.binding';
import { applyBinding } from './addon-import-binding.apply';
import {
  decodeImportString,
  type DecodedAddonImport,
} from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import {
  buildResult,
  parseImportRequest,
  rawFacts,
  runSection,
  type AttemptFacts,
} from './addon-import.service.helpers';

/**
 * ROK-1724 §4.3 — owner check → limit (atomically reserves the audit row) →
 * decode → bind (game, region, name, ruleset, GUID) → preview/apply in ONE
 * transaction → audit row finalised AFTER, outside the tx, on every outcome
 * incl. rejects (a reject before the reservation inserts its row then).
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
    try {
      const res = await this.attempt(userId, characterId, body, facts);
      result = res.status;
      return res;
    } catch (err) {
      if (err instanceof AddonImportError) result = err.code;
      throw err;
    } finally {
      await this.finish(userId, characterId, facts, result);
    }
  }

  private async attempt(
    userId: number,
    characterId: string,
    body: unknown,
    facts: AttemptFacts,
  ): Promise<AddonImportResultDto> {
    const request = parseImportRequest(body, facts);
    facts.dryRun = request.dryRun;
    facts.auditId = await this.audit.reserveAttempt(
      auditRow(userId, characterId, facts, ADDON_IMPORT_PENDING),
    );
    const decoded = decodeImportString(request.importString);
    facts.section = decoded.payload.section;
    facts.sha256 = decoded.sha256;
    const character = await this.loadCharacter(characterId);
    const binding = bindToCharacter(decoded.payload, character.binding, {
      dryRun: request.dryRun,
      confirm: request.confirm,
    });
    const [firstError] = binding.errors;
    if (firstError) throw firstError;
    return this.run(userId, character, decoded, binding, request);
  }

  /** Preview/apply + the binding's character-row writes, in one tx. */
  private run(
    userId: number,
    character: LoadedCharacter,
    decoded: DecodedAddonImport,
    binding: AddonBindingResult,
    request: AddonImportRequestDto,
  ): Promise<AddonImportResultDto> {
    return this.db.transaction(async (tx) => {
      const ctx = {
        tx,
        userId,
        characterId: character.id,
        gameId: character.gameId,
        region: character.binding.region as WowRegion,
        sha256: decoded.sha256,
      };
      const outcome = await runSection(ctx, decoded, request.dryRun);
      // Lead ruling: a stale export writes NOTHING — binding updates too.
      if (!request.dryRun && outcome.status !== 'stale') {
        await applyBinding(ctx, binding);
      }
      return buildResult(decoded, binding, outcome);
    });
  }

  /** The row the binding reads: owner-checked already, plus slug + GUID. */
  private async loadCharacter(characterId: string): Promise<LoadedCharacter> {
    const [row] = await this.db
      .select({ c: schema.characters, slug: schema.games.slug })
      .from(schema.characters)
      .innerJoin(schema.games, eq(schema.games.id, schema.characters.gameId))
      .where(eq(schema.characters.id, characterId))
      .limit(1);
    if (!row) throw new AddonImportError('WRONG_GAME');
    const { c } = row;
    return {
      id: c.id,
      gameId: c.gameId,
      binding: {
        gameSlug: row.slug,
        name: c.name,
        region: c.region,
        ruleset: c.ruleset,
        class: c.class,
        level: c.level,
        addonGuid: c.addonGuid,
      },
    };
  }

  private async finish(
    userId: number,
    characterId: string,
    facts: AttemptFacts,
    result: string,
  ): Promise<void> {
    this.logger.log(
      `addon-import userId=${userId} section=${facts.section ?? '-'} sha256=${facts.sha256 ?? '-'} size=${facts.sizeBytes} dryRun=${facts.dryRun} result=${result}`,
    );
    await this.audit.recordAttempt(
      auditRow(userId, characterId, facts, result),
      facts.auditId,
    );
  }
}

function auditRow(
  userId: number,
  characterId: string,
  facts: AttemptFacts,
  result: string,
): AddonImportAuditInsert {
  return {
    userId,
    characterId,
    section: facts.section,
    payloadSha256: facts.sha256,
    sizeBytes: facts.sizeBytes,
    dryRun: facts.dryRun,
    result,
  };
}

interface LoadedCharacter {
  id: string;
  gameId: number;
  binding: AddonBindingCharacter;
}
