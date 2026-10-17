/**
 * "Add time away" form (ROK-1585) in two layouts:
 * - `stacked` (phone drawer A, desktop modal): label, chips, From/To, note, span, submit;
 * - `inline` (desktop D1): ONE add line — chips · From · To · note toggle · submit —
 *   with the note revealed on its own row underneath.
 * `AwaySubmit` is exported on its own so the phone drawer can pin it in its footer.
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../../../ui/button';
import { Field } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { activePick } from './away-panel.helpers';
import { AwayRangeChips } from './AwayRangeChips';
import type { AbsenceSectionCtl } from './use-absence-section';

const LABEL_CLS = 'text-xs font-medium text-muted';
/** Matches the primitive Field label so the inline add line reads as one row of captions. */
const CAPTION_CLS = 'mb-1.5 text-sm font-medium text-secondary';

function submitLabel(ctl: AbsenceSectionCtl): string {
    if (ctl.isPending) return 'Adding…';
    return ctl.canSubmit ? `Add absence · ${ctl.spanText}` : 'Add absence';
}

/**
 * The one primary: "Add absence" (disabled) / "Add absence · N days" / "Adding…".
 * Native `disabled`, not `loading`: the smoke asserts `toBeDisabled` while the range is invalid.
 */
export function AwaySubmit({ ctl, className }: { ctl: AbsenceSectionCtl; className?: string }): JSX.Element {
    return (
        <Button
            fullWidth data-testid="absence-submit" disabled={!ctl.canSubmit}
            onClick={() => { void ctl.submit(); }} className={className}
        >
            {submitLabel(ctl)}
        </Button>
    );
}

/** A caption over the range chips — a group, not one control, so it is not a `<label>`. */
function Captioned({ caption, children }: { caption: string; children: ReactNode }): JSX.Element {
    return (
        <div className="flex min-w-0 flex-col">
            <span className={CAPTION_CLS}>{caption}</span>
            {children}
        </div>
    );
}

function DateFields({ ctl }: { ctl: AbsenceSectionCtl }): JSX.Element {
    const { startDate, endDate } = ctl.form;
    return (
        <>
            <Field label="From" className="min-w-0">
                <Input type="date" data-testid="away-from" className="min-w-0"
                    value={startDate} onChange={(e) => ctl.patch({ startDate: e.target.value })} />
            </Field>
            <Field label="To" className="min-w-0">
                <Input type="date" data-testid="away-to" className="min-w-0"
                    value={endDate} min={startDate || undefined}
                    onChange={(e) => ctl.patch({ endDate: e.target.value })} />
            </Field>
        </>
    );
}

function NoteToggle({ ctl }: { ctl: AbsenceSectionCtl }): JSX.Element {
    return (
        <Button
            variant="ghost" size="sm" data-testid="away-note-toggle" aria-expanded={ctl.form.noteOpen}
            onClick={() => ctl.patch({ noteOpen: !ctl.form.noteOpen })} className="self-start whitespace-nowrap"
        >
            + Add a note
        </Button>
    );
}

function NoteInput({ ctl }: { ctl: AbsenceSectionCtl }): JSX.Element | null {
    if (!ctl.form.noteOpen) return null;
    return (
        <Input
            type="text" aria-label="Note" data-testid="away-note" maxLength={255}
            placeholder="Optional, e.g. Lake trip"
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
                <Captioned caption="Quick range">
                    <AwayRangeChips active={activePick(ctl.form.startDate, ctl.form.endDate, ctl.today)} onPick={ctl.pick} />
                </Captioned>
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
