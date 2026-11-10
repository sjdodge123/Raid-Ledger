/**
 * ROK-2144 (placement B): when the viewer's progress and the quest catalogue were
 * captured, under the Quest Prep header —
 *   "Your progress: completed list via addon · 2 Nov 2026 · quest log 9 Nov 2026"
 *   "Quest data via Blizzard · 9 Nov 2026"
 * The progress line replaces the per-card prereq source line (it repeated the same
 * viewer date on every chained card). No staleness warning (operator Q6).
 */
import type { EventQuestPrereqsResponse } from '@raid-ledger/contract';
import { asDatedSource, formatCaptureDate, formatDatedLine, formatSourceLine, type DatedSource } from '../lib/addon-source-line';

type Prereqs = NonNullable<EventQuestPrereqsResponse>;

/**
 * The completed list's source: the server's `asOfSource` (ROK-2144 MINOR-1 — set even
 * when the viewer has completed none of this event's quests), else inferred from the
 * first dated completion, else the first dated step (an older api without the field).
 */
function completedListSource(prereqs: Prereqs): DatedSource | null {
    const declared = asDatedSource(prereqs.asOfSource);
    if (declared) return declared;
    for (const state of prereqs.quests) {
        const source = asDatedSource(state.completedSource);
        if (source) return source;
    }
    for (const state of prereqs.quests) {
        for (const step of state.steps) {
            const source = asDatedSource(step.source);
            if (source) return source;
        }
    }
    return null;
}

/**
 * The progress line text, or null without a dated snapshot. The quest-log date is
 * shown only when it falls on another day than the completed list's.
 */
function progressAsOfText(prereqs: Prereqs): string | null {
    const completedDate = formatCaptureDate(prereqs.asOf);
    if (!completedDate) return null;
    const source = completedListSource(prereqs);
    const via = source ? formatSourceLine(source, prereqs.asOf ?? '') : completedDate;
    const logDate = formatCaptureDate(prereqs.inProgressAsOf);
    if (!logDate || logDate === completedDate) return `Your progress: ${via}`;
    return `Your progress: completed list ${via} · quest log ${logDate}`;
}

/** Both as-of lines; nothing for a viewer without a Forever character (root-null response). */
export function QuestPrepAsOfLine({ prereqs }: { prereqs: EventQuestPrereqsResponse | undefined }) {
    if (!prereqs) return null;
    const progress = progressAsOfText(prereqs);
    const catalogue = formatCaptureDate(prereqs.questDataImportedAt)
        ? formatDatedLine('Quest data via Blizzard', prereqs.questDataImportedAt)
        : null;
    if (!progress && !catalogue) return null;
    return (
        <>
            {progress && <p className="text-xs text-muted" data-testid="quest-prep-progress-asof">{progress}</p>}
            {catalogue && <p className="text-xs text-dim" data-testid="quest-prep-catalogue-asof">{catalogue}</p>}
        </>
    );
}
