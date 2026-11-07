import { useMemo, useRef, useState, type JSX } from 'react';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';
import { groupBindingsByChannel } from './channel-binding-groups';
import { ChannelBindingGroupCard } from './ChannelBindingGroupCard';
import { ChannelBindingRow } from './ChannelBindingRow';

interface ChannelBindingListProps {
  bindings: ChannelBindingDto[];
  onUpdate: (id: string, dto: UpdateChannelBindingDto) => void | Promise<unknown>;
  onDelete: (id: string) => void;
  isUpdating: boolean;
  isDeleting: boolean;
  /** ROK-1416: a rejected PATCH surfaced inside the open edit form (form stays open). */
  updateError?: string | null;
  /**
   * TDB:259: fires whenever a row's editor opens, closes or switches rows. The
   * page resets its update mutation here — `updateError` is one value shared by
   * every row, so without it row A's rejected save reappears in row B's form.
   * The list additionally shows `updateError` only in the row that last saved.
   */
  onEditingChange?: (id: string | null) => void;
}

function isThenable(value: unknown): value is Promise<unknown> {
    return !!value && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Which row's editor is open, and which row saved last. ROK-1416: collapse the
 * row only once the PATCH resolves so a rejected save (400/409) keeps the form
 * open with its error instead of vanishing. A void return (fire-and-forget)
 * closes synchronously. Both the collapse and the error belong to the SAVED
 * row: if the admin has moved to another row meanwhile, that row stays open
 * and never shows the saved row's rejection.
 */
function useBindingEditor(
    onUpdate: ChannelBindingListProps['onUpdate'], onEditingChange: ChannelBindingListProps['onEditingChange'],
) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [savedId, setSavedId] = useState<string | null>(null);
    // ROK-1428: the row whose pin was the last PATCH — owns the pin spinner + error.
    const [pinId, setPinId] = useState<string | null>(null);
    // Read when the PATCH settles: the promise callback's closure holds the render-time editingId.
    const editingRef = useRef<string | null>(null);
    const changeEditing = (id: string | null) => { editingRef.current = id; setEditingId(id); onEditingChange?.(id); };
    // The page toasts + rethrows a rejected PATCH; the row's inline error comes from
    // the mutation state, so the rejection is consumed here (Codex r5), like handleSave.
    const handlePin = (id: string, pinned: boolean) => {
        setSavedId(id);
        setPinId(id);
        const result: unknown = onUpdate(id, { pinned });
        if (isThenable(result)) result.catch(() => {});
    };
    const handleSave = (id: string, dto: UpdateChannelBindingDto) => {
        setSavedId(id);
        setPinId(null);
        const result: unknown = onUpdate(id, dto);
        if (!isThenable(result)) { changeEditing(null); return; }
        result.then(() => { if (editingRef.current === id) changeEditing(null); }).catch(() => {});
    };
    return { editingId, savedId, pinId, changeEditing, handleSave, handlePin };
}

function EmptyBindings(): JSX.Element {
    return (
        <div className="text-center py-12 text-muted">
            <p className="text-lg">No channel bindings configured</p>
            <p className="text-sm mt-1">Use the <code className="text-foreground bg-overlay px-1 py-0.5 rounded">/bind</code> command in Discord to set up channel bindings, or add one below.</p>
        </div>
    );
}

/**
 * All channel bindings, grouped by Discord channel (ROK-2106): one card per
 * channel, one row per binding, with inline editing, inert repair and delete.
 */
export function ChannelBindingList({ bindings, onUpdate, onDelete, isUpdating, isDeleting, updateError, onEditingChange }: ChannelBindingListProps): JSX.Element {
    const { editingId, savedId, pinId, changeEditing, handleSave, handlePin } = useBindingEditor(onUpdate, onEditingChange);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const groups = useMemo(() => groupBindingsByChannel(bindings), [bindings]);
    if (bindings.length === 0) return <EmptyBindings />;
    const handleDelete = (id: string) => { setDeletingId(id); onDelete(id); };
    // ROK-1428: a pin is a direct PATCH (no editor); its spinner + error stay on the pinned channel.
    const pinFor = (id: string | undefined) => ({ onPin: handlePin, loading: isUpdating && pinId === id,
        locked: isUpdating && pinId !== id, error: pinId === id ? updateError : null });
    return (
        <div className="space-y-3">
            {groups.map((group) => (
                <ChannelBindingGroupCard key={group.key} group={group} pin={pinFor(group.lifecycleBinding?.id)}>
                    {group.bindings.map((binding) => (
                        <ChannelBindingRow key={binding.id} binding={binding} isEditing={editingId === binding.id}
                            setEditingId={changeEditing} onSave={handleSave} onDelete={handleDelete}
                            isRemoving={isDeleting && deletingId === binding.id}
                            // One PATCH at a time: the row that saved shows loading; every other open row is locked.
                            isSaving={isUpdating && savedId === binding.id} saveLocked={isUpdating && savedId !== binding.id}
                            updateError={savedId === binding.id && pinId !== binding.id ? updateError : null} />
                    ))}
                </ChannelBindingGroupCard>
            ))}
        </div>
    );
}
