/**
 * ROK-1786 — one recommended-addon row (prototype `AddonRow.tsx`). Members
 * see name, source, required/optional, note, flavor and the link. Editors
 * also get up/down, Edit and Remove — except on pinned rows, which are fixed.
 */
import { useState, type JSX } from 'react';
import {
    ArrowDownIcon, ArrowTopRightOnSquareIcon, ArrowUpIcon, LockClosedIcon, PencilSquareIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { AddonDetailFields } from './addon-form';
import type { AddonDetails, AddonView } from './addon-view';
import { Pill } from '../../../components/hub/hub-bits';

/** Per-call outcome of a row save; the editor closes only on success. */
export interface SaveCallbacks { onSuccess: () => void; onError: (error: Error) => void }

export interface RowActions {
    onMove: (id: number, dir: -1 | 1) => void;
    onSave: (id: number, details: AddonDetails, callbacks: SaveCallbacks) => void;
    onRemove: (id: number) => void;
}

function AddonSummary({ addon, pinned }: { addon: AddonView; pinned: boolean }): JSX.Element {
    return (
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
                <span className="break-words font-semibold text-foreground">{addon.name}</span>
                {pinned && <Pill tone="success"><LockClosedIcon className="h-3 w-3" aria-hidden="true" />Pinned</Pill>}
                <Pill tone={addon.required ? 'warning' : 'neutral'}>{addon.required ? 'Required' : 'Optional'}</Pill>
                <Pill>{addon.source}</Pill>
                <Pill>{addon.flavorLabel}</Pill>
            </div>
            {addon.note && <p className="mt-1 break-words text-sm text-secondary">{addon.note}</p>}
            <a href={addon.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1 text-sm text-success hover:underline lg:min-h-0">
                Open on {addon.source}<ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
            </a>
        </div>
    );
}

function EditorControls({ addon, id, actions, isFirst, isLast, onEdit }: {
    addon: AddonView; id: number; actions: RowActions; isFirst: boolean; isLast: boolean; onEdit: () => void;
}): JSX.Element {
    return (
        <div className="flex shrink-0 flex-wrap gap-1">
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${addon.name} up`} disabled={isFirst} onClick={() => actions.onMove(id, -1)}>
                <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${addon.name} down`} disabled={isLast} onClick={() => actions.onMove(id, 1)}>
                <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Edit ${addon.name}`} onClick={onEdit}>
                <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="destructive-soft" size="sm" iconOnly aria-label={`Remove ${addon.name}`} onClick={() => actions.onRemove(id)}>
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
        </div>
    );
}

interface EditState { saving: boolean; error: string | null }

function RowEditor({ addon, initial, state, onSave, onCancel }: {
    addon: AddonView; initial: AddonDetails; state: EditState; onSave: (d: AddonDetails) => void; onCancel: () => void;
}): JSX.Element {
    const [draft, setDraft] = useState<AddonDetails>(initial);
    return (
        <div className="flex flex-col gap-3">
            <span className="font-semibold text-foreground">Editing {addon.name}</span>
            <AddonDetailFields value={draft} onChange={setDraft} />
            {state.error && (
                <p role="alert" data-testid="guild-addon-edit-error" className="text-sm text-danger">
                    Couldn’t save {addon.name}. {state.error}
                </p>
            )}
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button onClick={() => onSave(draft)} loading={state.saving}>Save</Button>
            </div>
        </div>
    );
}

/** Editor open/closed plus the in-flight save; a failed save keeps the edit open. */
function useRowEdit(id: number | null, actions: RowActions) {
    const [editing, setEditing] = useState(false);
    const [state, setState] = useState<EditState>({ saving: false, error: null });
    const close = (): void => { setEditing(false); setState({ saving: false, error: null }); };
    const save = (d: AddonDetails): void => {
        if (id === null) return;
        setState({ saving: true, error: null });
        actions.onSave(id, d, { onSuccess: close, onError: (e) => setState({ saving: false, error: e.message }) });
    };
    return { editing, open: () => setEditing(true), close, save, state };
}

export function AddonRow({ addon, details, canEdit, actions, isFirst, isLast }: {
    addon: AddonView; details?: AddonDetails; canEdit: boolean; actions: RowActions; isFirst: boolean; isLast: boolean;
}): JSX.Element {
    const id = addon.id;
    const pinned = id === null;
    const edit = useRowEdit(id, actions);
    return (
        <li data-testid={pinned ? 'guild-addon-pinned' : 'guild-addon-row'}
            className={`rounded-lg border p-3 ${pinned ? 'border-success/30 bg-success/5' : 'border-edge bg-surface'}`}>
            {canEdit && id !== null && edit.editing && details ? (
                <RowEditor addon={addon} initial={details} state={edit.state} onCancel={edit.close} onSave={edit.save} />
            ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <AddonSummary addon={addon} pinned={pinned} />
                    {canEdit && id !== null && <EditorControls addon={addon} id={id} actions={actions} isFirst={isFirst} isLast={isLast} onEdit={edit.open} />}
                    {canEdit && pinned && <span className="text-xs text-muted sm:max-w-[10rem] sm:text-right">Pinned on every guild. Can&apos;t be removed.</span>}
                </div>
            )}
        </li>
    );
}
