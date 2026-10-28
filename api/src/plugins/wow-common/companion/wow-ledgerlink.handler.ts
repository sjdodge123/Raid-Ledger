/**
 * ROK-1964 §6.2 — the `wow-ledgerlink` v1 companion contract handler, owned
 * by the `blizzard` plugin. One message = one LedgerLink export run (D4); its
 * string goes through the SAME path as a paste on
 * `POST /plugins/wow/characters/addon-import` (`importNew`), as the device
 * token's user, applied with no preview (D2: `dryRun: false`, no `confirm`).
 *
 * D1 (Lead, accepted): the import runs on its OWN db connection, not
 * `ctx.tx` — it owns its transaction, advisory locks, post-tx audit row and
 * gear enqueue. No `latestWins`: the import's per-section noop (same sha) /
 * stale (older export) logic is authoritative, so the ingest tx holds only
 * the device row. Every import outcome (applied / noop / stale) acks
 * `accepted`; a reject throws a companion error and the ingest rolls back.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  AddonImportNewResultDto,
  WowLedgerlinkMessage,
} from '@raid-ledger/contract';
import type {
  CompanionContractHandler,
  CompanionHandlerContext,
} from '../../../companion/ingest/companion-handler.registry';
import type { CompanionIngestVia } from '../../../companion/ingest/companion-ingest-request';
import { AddonImportCreateService } from '../addon-import/addon-import-create.service';
import { AddonImportError } from '../addon-import/addon-import.errors';
import {
  companionErrorForImport,
  companionErrorForImportCode,
} from './wow-ledgerlink.errors';

/** Ids, the import status and section statuses only — never the string. */
export function describeImportOutcome(res: AddonImportNewResultDto): string {
  const sections = (res.sections ?? []).map((s) => s.status).join(',');
  const target = `${res.target.action}:${res.target.characterId ?? '-'}`;
  return `status=${res.status} sections=${sections || '-'} target=${target}`;
}

@Injectable()
export class WowLedgerlinkHandler implements CompanionContractHandler<WowLedgerlinkMessage> {
  /** A literal: the ownership guard's scan reads it (`WOW_LEDGERLINK_CONTRACT_ID`). */
  readonly contract = 'wow-ledgerlink';
  readonly versions: readonly number[] = [1];
  /** Device tokens only — the browser already has the paste dialog. */
  readonly sources: readonly CompanionIngestVia[] = ['device'];
  private readonly logger = new Logger(WowLedgerlinkHandler.name);

  constructor(private readonly imports: AddonImportCreateService) {}

  async handle(
    ctx: CompanionHandlerContext,
    msg: WowLedgerlinkMessage,
  ): Promise<void> {
    const who = `user=${ctx.userId} device=${ctx.deviceId ?? '-'}`;
    // The paste route trims and rejects a blank string with a plain 400 that
    // carries no companion code — refuse it here with the pinned one instead.
    if (msg.payload.exportString.trim() === '') {
      this.logger.log(`wow-ledgerlink ${who} rejected code=INVALID_PAYLOAD`);
      throw companionErrorForImportCode('INVALID_PAYLOAD');
    }
    let res: AddonImportNewResultDto;
    try {
      res = await this.imports.importNew(ctx.userId, {
        importString: msg.payload.exportString,
        dryRun: false,
      });
    } catch (err: unknown) {
      if (err instanceof AddonImportError) {
        this.logger.log(`wow-ledgerlink ${who} rejected code=${err.code}`);
      }
      throw companionErrorForImport(err);
    }
    this.logger.log(`wow-ledgerlink ${who} ${describeImportOutcome(res)}`);
  }
}
