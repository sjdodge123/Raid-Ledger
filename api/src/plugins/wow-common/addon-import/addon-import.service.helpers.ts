import {
  ADDON_IMPORT_MAX_BYTES,
  AddonImportRequestSchema,
  type AddonExportSection,
  type AddonImportRequestDto,
  type AddonImportResultDto,
} from '@raid-ledger/contract';
import { handleValidationError } from '../../../common/validation.util';
import type { AddonBindingResult } from './addon-import.binding';
import type { DecodedAddonImport } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import type {
  AddonApplyContext,
  AddonSectionOutcome,
} from './addon-import-apply.types';
import { applyChar, previewChar } from './addon-import-char.apply';
import { applyGuild, previewGuild } from './addon-import-guild.apply';
import { applyRaid, previewRaid } from './addon-import-raid.apply';

/** What the service knows about an attempt, for the audit row + log line. */
export interface AttemptFacts {
  sizeBytes: number;
  dryRun: boolean;
  section: AddonExportSection | null;
  sha256: string | null;
}

const SECTION_SNIFF = /^\s*!RL\d+!(char|guild|raid)\b/;

/** Header section without decoding anything (audit only). */
export function sniffSection(raw: unknown): AddonExportSection | null {
  if (typeof raw !== 'string') return null;
  const match = SECTION_SNIFF.exec(raw.slice(0, 32));
  return (match?.[1] as AddonExportSection | undefined) ?? null;
}

/** Facts readable from the raw body before validation. */
export function rawFacts(body: unknown): AttemptFacts {
  const b = (body ?? {}) as { importString?: unknown; dryRun?: unknown };
  const str = typeof b.importString === 'string' ? b.importString.trim() : '';
  return {
    sizeBytes: Buffer.byteLength(str, 'utf8'),
    dryRun: b.dryRun !== false,
    section: sniffSection(str),
    sha256: null,
  };
}

/**
 * Size BEFORE the schema: the schema caps `importString` at 262_144, so a
 * plain Zod parse would answer an oversized paste with 400 instead of the
 * contract's 413 `TOO_LARGE`. The string is trimmed first, as the decoder
 * does, so trailing whitespace from a copy never trips the cap.
 */
export function parseImportRequest(
  body: unknown,
  facts: AttemptFacts,
): AddonImportRequestDto {
  if (facts.sizeBytes > ADDON_IMPORT_MAX_BYTES) {
    throw new AddonImportError('TOO_LARGE');
  }
  const b = body as { importString?: unknown } | null;
  const input =
    b && typeof b === 'object' && typeof b.importString === 'string'
      ? { ...b, importString: b.importString.trim() }
      : body;
  const parsed = AddonImportRequestSchema.safeParse(input);
  if (!parsed.success) handleValidationError(parsed.error);
  return parsed.data;
}

type AnyOutcome = AddonSectionOutcome<AddonImportResultDto['summary']>;

/** Section dispatch: preview (reads only) or apply (writes in `ctx.tx`). */
export function runSection(
  ctx: AddonApplyContext,
  decoded: DecodedAddonImport,
  dryRun: boolean,
): Promise<AnyOutcome> {
  const { payload, pages } = decoded;
  if (payload.section === 'char') {
    return dryRun ? previewChar(ctx, payload) : applyChar(ctx, payload);
  }
  if (payload.section === 'guild') {
    return dryRun
      ? previewGuild(ctx, payload, pages)
      : applyGuild(ctx, payload, pages);
  }
  return dryRun ? previewRaid(ctx, payload) : applyRaid(ctx, payload);
}

/** The 200 body. A stale export also carries a `STALE_EXPORT` warning. */
export function buildResult(
  decoded: DecodedAddonImport,
  binding: AddonBindingResult,
  outcome: AnyOutcome,
): AddonImportResultDto {
  const warnings = [...binding.warnings];
  if (outcome.status === 'stale') warnings.push({ code: 'STALE_EXPORT' });
  return {
    section: decoded.payload.section,
    status: outcome.status,
    exportedAt: decoded.payload.exportedAt,
    warnings,
    diff: binding.diff,
    summary: outcome.summary,
  } as AddonImportResultDto;
}
