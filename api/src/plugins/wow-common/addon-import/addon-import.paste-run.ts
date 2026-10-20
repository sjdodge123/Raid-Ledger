import type {
  AddonImportResultDto,
  AddonImportSectionResultDto,
} from '@raid-ledger/contract';
import type { AddonBindingResult } from './addon-import.binding';
import type {
  DecodedAddonImport,
  DecodedAddonPaste,
} from './addon-import.decoder';
import type { AddonApplyContext } from './addon-import-apply.types';
import { buildResult, runSection } from './addon-import.service.helpers';

/**
 * ROK-1737 "Export all": a paste of 1–3 sections, previewed/applied in the
 * caller's ONE transaction. Sections run in canonical order char → guild →
 * raid, each routed exactly as a single-section import; a rejecting section
 * throws and rolls every section back (all-or-nothing). A stale section
 * writes nothing for itself and is reported, not thrown.
 */

type SectionOutcome = Awaited<ReturnType<typeof runSection>>;

/** One section's decode + outcome, in paste order. */
export interface PasteSectionRun {
  decoded: DecodedAddonImport;
  outcome: SectionOutcome;
}

/** The present sections, canonical order (the decoder's `order`). */
export function pasteSections(paste: DecodedAddonPaste): DecodedAddonImport[] {
  return paste.order.flatMap((section) => {
    const s = paste.sections[section];
    return s ? [s] : [];
  });
}

/** Run every section in `ctx.tx`; each section's own sha256 goes to its rows. */
export async function runPaste(
  ctx: Omit<AddonApplyContext, 'sha256'>,
  paste: DecodedAddonPaste,
  dryRun: boolean,
): Promise<PasteSectionRun[]> {
  const runs: PasteSectionRun[] = [];
  for (const decoded of pasteSections(paste)) {
    const sectionCtx = { ...ctx, sha256: decoded.sha256 };
    runs.push({
      decoded,
      outcome: await runSection(sectionCtx, decoded, dryRun),
    });
  }
  return runs;
}

/** True when the binding's character-row writes should run (not all stale). */
export function shouldApplyBinding(runs: PasteSectionRun[]): boolean {
  return runs.some((r) => r.outcome.status !== 'stale');
}

/**
 * ROK-1739 (Codex r4 P2) — a re-import of an already-imported export is a
 * section `noop`, but a realm mapped since then makes the binding's
 * `RULESET_CHANGED` a pending character-row change. On preview that noop
 * becomes `preview` so the opt-in is actionable; with no pending change
 * (incl. once the inferred ruleset is stored) it stays `noop`.
 */
export function withPendingBindingStatus(
  runs: PasteSectionRun[],
  binding: AddonBindingResult,
  dryRun: boolean,
): PasteSectionRun[] {
  const pending = binding.warnings.some((w) => w.code === 'RULESET_CHANGED');
  if (!dryRun || !pending) return runs;
  return runs.map((r) =>
    r.outcome.status === 'noop'
      ? { ...r, outcome: { ...r.outcome, status: 'preview' } }
      : r,
  );
}

/**
 * The 200 body. One section → exactly the ROK-1724 body. Several → the
 * top level mirrors the first section, `STALE_EXPORT` when ANY section is
 * stale, plus one `sections` entry per section.
 */
export function buildPasteResult(
  runs: PasteSectionRun[],
  binding: AddonBindingResult,
): AddonImportResultDto {
  const [first] = runs;
  if (!first) throw new Error('addon-import: a paste has at least 1 section');
  const top = buildResult(first.decoded, binding, first.outcome);
  if (runs.length === 1) return top;
  const anyStale = runs.some((r) => r.outcome.status === 'stale');
  const staleWarned = top.warnings.some((w) => w.code === 'STALE_EXPORT');
  if (anyStale && !staleWarned) top.warnings.push({ code: 'STALE_EXPORT' });
  return { ...top, sections: runs.map(sectionResult) };
}

function sectionResult(run: PasteSectionRun): AddonImportSectionResultDto {
  return {
    section: run.decoded.payload.section,
    status: run.outcome.status,
    exportedAt: run.decoded.payload.exportedAt,
    summary: run.outcome.summary,
  } as AddonImportSectionResultDto;
}
