import { Logger } from '@nestjs/common';
import type { AddonImportAuditInsert } from '../../../drizzle/schema';
import type { AddonImportAuditService } from './addon-import.audit';
import type { DecodedAddonPaste } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import { pasteSections } from './addon-import.paste-run';
import type { AttemptFacts } from './addon-import.service.helpers';

/**
 * ROK-1738 — the audit + log tail shared by the per-character route
 * (`AddonImportService`) and the create route (`AddonImportCreateService`):
 * one row per attempt (one per section for a mixed paste), finalised AFTER
 * the transaction on every outcome. Never logs or stores the pasted string
 * or its payload — only its sha256 and size.
 */

const logger = new Logger('AddonImportService');

/** What `finishAttempt` records about one attempt. */
export interface AttemptOutcome {
  userId: number;
  /** The imported character; null for a create that never got a row. */
  characterId: string | null;
  facts: AttemptFacts;
  result: string;
  perSection: string[];
}

/** Audit facts from a decoded paste. */
export function recordPasteFacts(
  facts: AttemptFacts,
  paste: DecodedAddonPaste,
): void {
  const sections = pasteSections(paste);
  const [first] = sections;
  if (!first) throw new AddonImportError('BAD_HEADER');
  facts.section = first.payload.section;
  facts.sha256 = first.sha256;
  if (sections.length > 1) {
    facts.sections = sections.map((s) => ({
      section: s.payload.section,
      sha256: s.sha256,
      sizeBytes: s.inputBytes,
    }));
  }
}

export function auditRow(
  userId: number,
  characterId: string | null,
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

/** Log line + audit row(s) for a finished attempt (best effort). */
export async function finishAttempt(
  audit: Pick<AddonImportAuditService, 'recordAttempt' | 'recordSections'>,
  o: AttemptOutcome,
): Promise<void> {
  const { facts } = o;
  const section = facts.sections.map((s) => s.section).join('+');
  logger.log(
    `addon-import userId=${o.userId} section=${section || (facts.section ?? '-')} sha256=${facts.sha256 ?? '-'} size=${facts.sizeBytes} dryRun=${facts.dryRun} result=${o.result}`,
  );
  const base = auditRow(o.userId, o.characterId, facts, o.result);
  if (facts.sections.length > 1) {
    // ROK-1737: one row per section; the paste still holds ONE reservation.
    const rows = facts.sections.map((s, i) => ({
      ...base,
      result: o.perSection[i] ?? o.result,
      section: s.section,
      payloadSha256: s.sha256,
      sizeBytes: s.sizeBytes,
    }));
    await audit.recordSections(rows, facts.auditId);
    return;
  }
  await audit.recordAttempt(base, facts.auditId);
}
