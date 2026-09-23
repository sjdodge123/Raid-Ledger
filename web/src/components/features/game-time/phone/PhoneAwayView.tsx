/**
 * The phone drawer's "I'm away" swap (ROK-1585 drawer A, artboards Week / A2 /
 * A4): the entry row on the week, and the away view it opens.
 *
 * The view is the shared stacked `AwayPanel` in a scrolling body with the add
 * button pinned in the drawer's sticky bar — and nothing else there: no "Save my
 * week", no Skip. Adding keeps the viewer on this view (A4: the list grows, the
 * form resets); the sheet's "‹" header is the way back.
 *
 * No new pattern: the panel is Lane A's `AwayPanel` / `AwaySubmit`, the entry
 * uses the check's `ANSWER_SECONDARY` recipe and the bar is `STEP_FOOTER_BAR`.
 * Unsaved form input reports dirty to the drawer's close guard (ROK-1640).
 */
import type { JSX, RefObject } from 'react';
import { ANSWER_SECONDARY } from '../game-time-check-copy';
import { AwayPanel } from '../away/AwayPanel';
import { AwaySubmit } from '../away/AwayAddForm';
import { useAbsenceSection } from '../away/use-absence-section';
import { STEP_FOOTER_BAR } from './phone-week-check.helpers';
import { useReportSheetDirty } from '../sheet-dirty-context';

/** "I'm away · <next range · +N more> ›" — the row that swaps the drawer. */
export function AwayEntry({ nextLabel, onOpen, entryRef }: {
    nextLabel: string | null; onOpen: () => void; entryRef?: RefObject<HTMLButtonElement | null>;
}): JSX.Element {
    return (
        <button
            ref={entryRef} type="button" data-testid="away-entry" onClick={onOpen}
            className={`${ANSWER_SECONDARY} flex items-center justify-between gap-2`}
        >
            <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-semibold">I&apos;m away</span>
                {nextLabel && (
                    <span data-testid="away-entry-next" className="truncate text-xs font-normal text-muted">{nextLabel}</span>
                )}
            </span>
            <span aria-hidden="true" className="text-lg leading-none text-muted">›</span>
        </button>
    );
}

/** The away view: scrolling stacked panel + a sticky bar holding only the add. */
export function PhoneAwayView(): JSX.Element {
    const ctl = useAbsenceSection();
    // ROK-1640: a range or note typed but not yet added is unsaved — the drawer
    // asks before a close drops it. Adding resets the form; back unmounts it.
    const { startDate, endDate, reason } = ctl.form;
    useReportSheetDirty(Boolean(startDate || endDate || reason.trim()));
    return (
        <div data-testid="phone-away-view" className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                <AwayPanel layout="stacked" hideSubmit ctl={ctl} />
            </div>
            <div data-testid="phone-away-footer" className={STEP_FOOTER_BAR}>
                <AwaySubmit ctl={ctl} className="flex-1" />
            </div>
        </div>
    );
}
