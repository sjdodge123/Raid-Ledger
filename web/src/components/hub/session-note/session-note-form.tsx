/**
 * ROK-1968 §6.2 — the editor dialog's fields: the Markdown body (4000 chars,
 * ruling 7), the checklist editor, and "Clear after the next event". The
 * checkbox names the event it will pin (ruling 4a) — the already-pinned one when
 * re-saving (4d), else the hub's next event — and is disabled when there is none.
 */
import type { JSX } from 'react';
import { HUB_POST_BODY_MAX, type HubSessionNoteClearAfter } from '@raid-ledger/contract';
import { Field } from '../../ui/field';
import { Checkbox } from '../../ui/checkbox';
import { useTimezoneStore } from '../../../stores/timezone-store';
import { LazyMarkdownEditor } from '../../ui/markdown/lazy-markdown-editor';
import { SessionNoteItemsEditor } from './session-note-items-editor';
import { formatClearAfter, type SessionNoteDraft } from './session-note.helpers';

export const NO_NEXT_EVENT_COPY = 'No upcoming event on this hub';
export const CLEAR_AFTER_LABEL = 'Clear after the next event';

interface ToggleProps {
    checked: boolean;
    target: HubSessionNoteClearAfter | null;
    onChange: (checked: boolean) => void;
}

function ClearAfterToggle({ checked, target, onChange }: ToggleProps): JSX.Element {
    // A Checkbox, not a Switch: this only takes effect on Save (design-system Switch rule).
    const timeZone = useTimezoneStore((s) => s.resolved);
    return (
        <Checkbox checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} label={CLEAR_AFTER_LABEL}
            disabled={target === null && !checked} data-testid="session-note-clear-after-checkbox"
            description={<span data-testid="session-note-clear-after-hint">
                {target === null ? NO_NEXT_EVENT_COPY : `Clears after ${formatClearAfter(target, timeZone)}`}
            </span>} />
    );
}

export interface SessionNoteFormProps {
    draft: SessionNoteDraft;
    onChange: (next: (draft: SessionNoteDraft) => SessionNoteDraft) => void;
    /** The event the saved note is already pinned to, if any. */
    pinned: HubSessionNoteClearAfter | null;
    nextEvent: HubSessionNoteClearAfter | null;
}

export function SessionNoteForm({ draft, onChange, pinned, nextEvent }: SessionNoteFormProps): JSX.Element {
    return (
        <div className="flex flex-col gap-5" data-testid="session-note-form">
            <Field label="Note">
                <LazyMarkdownEditor value={draft.body} maxLength={HUB_POST_BODY_MAX} testId="session-note-body-input"
                    placeholder="What should everyone know before next session?"
                    onChange={(body) => onChange((d) => ({ ...d, body }))} />
            </Field>
            <SessionNoteItemsEditor items={draft.items}
                onChange={(next) => onChange((d) => ({ ...d, items: next(d.items) }))} />
            <ClearAfterToggle checked={draft.clearAfterNextEvent} target={pinned ?? nextEvent}
                onChange={(clearAfterNextEvent) => onChange((d) => ({ ...d, clearAfterNextEvent }))} />
        </div>
    );
}
