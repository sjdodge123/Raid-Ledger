/**
 * "Add time away" form (ROK-1585) in two layouts:
 * - `stacked` (phone drawer A, desktop modal): label, chips, From/To, note, span, submit;
 * - `inline` (desktop D1): ONE add line — chips · From · To · note toggle · submit —
 *   with the note revealed on its own row underneath.
 * `AwaySubmit` is exported on its own so the phone drawer can pin it in its footer.
 */
import { useId, type JSX, type ReactNode } from 'react';
import { ANSWER_PRIMARY } from '../game-time-check-copy';
import { activePick } from './away-panel.helpers';
import { AwayRangeChips } from './AwayRangeChips';
import type { AbsenceSectionCtl } from './use-absence-section';

const INPUT_CLS = 'min-h-[44px] w-full min-w-0 rounded-lg border border-edge-strong bg-surface px-3 text-sm text-foreground focus:border-emerald-500 focus:outline-none';
const LABEL_CLS = 'text-xs font-medium text-muted';
const SUBMIT_CLS = ANSWER_PRIMARY.replace('text-left', 'text-center');

function submitLabel(ctl: AbsenceSectionCtl): string {
    if (ctl.isPending) return 'Adding…';
    return ctl.canSubmit ? `Add absence · ${ctl.spanText}` : 'Add absence';
}

/** The one primary: "Add absence" (disabled) / "Add absence · N days" / "Adding…". */
export function AwaySubmit({ ctl, className = '' }: { ctl: AbsenceSectionCtl; className?: string }): JSX.Element {
    return (
        <button
            type="button" data-testid="absence-submit" disabled={!ctl.canSubmit}
            onClick={() => { void ctl.submit(); }} className={`${SUBMIT_CLS} ${className}`}
        >
            {submitLabel(ctl)}
        </button>
    );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }): JSX.Element {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            {htmlFor ? <label htmlFor={htmlFor} className={LABEL_CLS}>{label}</label> : <span className={LABEL_CLS}>{label}</span>}
            {children}
        </div>
    );
}

function DateFields({ ctl }: { ctl: AbsenceSectionCtl }): JSX.Element {
    const id = useId();
    const { startDate, endDate } = ctl.form;
    return (
        <>
            <Field label="From" htmlFor={`${id}-from`}>
                <input id={`${id}-from`} type="date" data-testid="away-from" className={INPUT_CLS}
                    value={startDate} onChange={(e) => ctl.patch({ startDate: e.target.value })} />
            </Field>
            <Field label="To" htmlFor={`${id}-to`}>
                <input id={`${id}-to`} type="date" data-testid="away-to" className={INPUT_CLS}
                    value={endDate} min={startDate || undefined}
                    onChange={(e) => ctl.patch({ endDate: e.target.value })} />
            </Field>
        </>
    );
}

function NoteToggle({ ctl }: { ctl: AbsenceSectionCtl }): JSX.Element {
    return (
        <button
            type="button" data-testid="away-note-toggle" aria-expanded={ctl.form.noteOpen}
            onClick={() => ctl.patch({ noteOpen: !ctl.form.noteOpen })}
            className="min-h-[44px] self-start whitespace-nowrap text-sm font-medium text-emerald-400 hover:underline"
        >
            + Add a note
        </button>
    );
}

function NoteInput({ ctl }: { ctl: AbsenceSectionCtl }): JSX.Element | null {
    if (!ctl.form.noteOpen) return null;
    return (
        <input
            type="text" data-testid="away-note" aria-label="Note" maxLength={255}
            placeholder="Optional, e.g. Lake trip" className={`${INPUT_CLS} placeholder-dim`}
            value={ctl.form.reason} onChange={(e) => ctl.patch({ reason: e.target.value })}
        />
    );
}

function StackedForm({ ctl, hideSubmit }: { ctl: AbsenceSectionCtl; hideSubmit: boolean }): JSX.Element {
    return (
        <div className="flex flex-col gap-3">
            <p className={LABEL_CLS}>Add time away</p>
            <AwayRangeChips active={activePick(ctl.form.startDate, ctl.form.endDate, ctl.today)} onPick={ctl.pick} />
            <div className="grid grid-cols-2 gap-2"><DateFields ctl={ctl} /></div>
            <div className="flex items-center justify-between gap-3">
                <NoteToggle ctl={ctl} />
                <span className="text-xs tabular-nums text-muted" data-testid="absence-span">{ctl.spanText}</span>
            </div>
            <NoteInput ctl={ctl} />
            {!hideSubmit && <AwaySubmit ctl={ctl} />}
        </div>
    );
}

function InlineForm({ ctl, hideSubmit }: { ctl: AbsenceSectionCtl; hideSubmit: boolean }): JSX.Element {
    return (
        <div className="flex flex-col gap-2.5">
            <div data-testid="away-add-line" className="grid items-end gap-2.5 lg:grid-cols-[auto_1fr_1fr_auto_auto]">
                <Field label="Quick range">
                    <AwayRangeChips active={activePick(ctl.form.startDate, ctl.form.endDate, ctl.today)} onPick={ctl.pick} />
                </Field>
                <DateFields ctl={ctl} />
                <NoteToggle ctl={ctl} />
                {!hideSubmit && <AwaySubmit ctl={ctl} className="whitespace-nowrap lg:w-auto" />}
            </div>
            <NoteInput ctl={ctl} />
        </div>
    );
}

/** The add form for either layout; `hideSubmit` when the caller pins `AwaySubmit` elsewhere. */
export function AwayAddForm({ layout, ctl, hideSubmit = false }: {
    layout: 'stacked' | 'inline'; ctl: AbsenceSectionCtl; hideSubmit?: boolean;
}): JSX.Element {
    return layout === 'inline'
        ? <InlineForm ctl={ctl} hideSubmit={hideSubmit} />
        : <StackedForm ctl={ctl} hideSubmit={hideSubmit} />;
}
