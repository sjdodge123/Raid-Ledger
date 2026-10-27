/**
 * ROK-1968 §6.2 — the editor dialog's fields: the Markdown body (4000 chars,
 * ruling 7), the checklist editor, and "Clear after the next event". The
 * switch names the event it will pin (ruling 4a) — the already-pinned one when
 * re-saving (4d), else the hub's next event — and is disabled when there is none.
 */
import { useId, type JSX } from 'react';
import { HUB_POST_BODY_MAX, type HubSessionNoteClearAfter } from '@raid-ledger/contract';
import { Field } from '../../ui/field';
import { Switch } from '../../ui/switch';
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
    const hintId = useId();
    return (
        <div className="flex items-start gap-3">
            <Switch checked={checked} onChange={onChange} label={CLEAR_AFTER_LABEL} aria-describedby={hintId}
                disabled={target === null && !checked} testId="session-note-clear-after-switch" className="mt-0.5" />
            <div className="flex flex-col">
                <span className="text-sm text-foreground">{CLEAR_AFTER_LABEL}</span>
                <span id={hintId} className="text-xs text-muted" data-testid="session-note-clear-after-hint">
                    {target === null ? NO_NEXT_EVENT_COPY : `Clears after ${formatClearAfter(target)}`}
                </span>
            </div>
        </div>
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
