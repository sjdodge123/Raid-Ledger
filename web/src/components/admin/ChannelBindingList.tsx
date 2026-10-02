import { useRef, useState } from 'react';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';
import { classifyBindingTriple } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { BindingConfigForm } from './BindingConfigForm';
import { useMultiMonitorChannels } from './use-multi-monitor-channels';

const BEHAVIOR_LABELS: Record<string, string> = {
  'game-announcements': 'Event Announcements',
  'game-voice-monitor': 'Quick Play Events (Activity Monitoring) & Game Event Announcements',
  'general-lobby': 'General Lobby',
};

const BEHAVIOR_BADGES: Record<string, { label: string; className: string }> = {
  'game-announcements': { label: 'Announcements', className: 'bg-cyan-500/15 text-cyan-400' },
  'game-voice-monitor': { label: 'Activity Monitor', className: 'bg-purple-500/15 text-purple-400' },
  'general-lobby': { label: 'General Lobby', className: 'bg-amber-500/15 text-amber-400' },
};

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

/** ROK-1415/1416: any triple the shared classifier rejects renders as INERT. */
function isBindingInert(binding: ChannelBindingDto): boolean {
  return classifyBindingTriple(binding.channelType, binding.bindingPurpose, binding.gameId) != null;
}

function ChannelTypeIcon({ type }: { type: string }) {
    if (type === 'voice') {
        return <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>;
    }
    return <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /></svg>;
}

function BindingBadge({ purpose }: { purpose: string }) {
    const badge = BEHAVIOR_BADGES[purpose];
    if (!badge) return null;
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}>{badge.label}</span>;
}

/** Status tone on the danger tokens (design-system §4.7) so it reads in both colour families. */
function InertBadge() {
    return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-danger/10 text-danger border border-danger/30">
            ⚠ INERT — Quick Play can&apos;t fire
        </span>
    );
}

function MultiMonitorNote() {
    return (
        <p className="text-xs text-amber-400 mt-1">
            Heads up: this channel monitors more than one game. While a scheduled event for one game is
            live, Quick Play pauses for the others on this channel until it ends. This is a supported setup.
        </p>
    );
}

function BindingInfo({ binding, hasMultiMonitor, isInert }: { binding: ChannelBindingDto; hasMultiMonitor: boolean; isInert: boolean }) {
    return (
        <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0"><ChannelTypeIcon type={binding.channelType} /></div>
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">#{binding.channelName ?? binding.channelId}</span>
                    <BindingBadge purpose={binding.bindingPurpose} />
                    {isInert && <InertBadge />}
                </div>
                <p className="text-xs text-muted mt-0.5">
                    {binding.gameName ? binding.gameName : 'All games'}{' · '}{BEHAVIOR_LABELS[binding.bindingPurpose] ?? binding.bindingPurpose}
                </p>
                {hasMultiMonitor && <MultiMonitorNote />}
            </div>
        </div>
    );
}

function BindingActions({ binding, isEditing, isInert, onToggleEdit, onFix, onDelete, isDeleting, deletingId }: {
    binding: ChannelBindingDto; isEditing: boolean; isInert: boolean; onToggleEdit: () => void; onFix: () => void;
    onDelete: (id: string) => void; isDeleting: boolean; deletingId: string | null;
}) {
    const isRemoving = isDeleting && deletingId === binding.id;
    return (
        <div data-testid="channel-binding-actions" className="flex flex-wrap items-center gap-2 flex-shrink-0">
            {isInert && !isEditing && <Button size="sm" onClick={onFix}>Fix &rarr;</Button>}
            <Button size="sm" variant="secondary" onClick={onToggleEdit}>
                {isEditing ? 'Close' : 'Edit'}
            </Button>
            <Button size="sm" variant="destructive-soft" onClick={() => onDelete(binding.id)}
                loading={isRemoving} loadingLabel="Removing...">
                Remove
            </Button>
        </div>
    );
}

function BindingRow({ binding, editingId, setEditingId, onSave, onDelete, isUpdating, isDeleting, deletingId, hasMultiMonitor, updateError }: {
    binding: ChannelBindingDto; editingId: string | null; setEditingId: (id: string | null) => void;
    onSave: (id: string, dto: UpdateChannelBindingDto) => void; onDelete: (id: string) => void;
    isUpdating: boolean; isDeleting: boolean; deletingId: string | null; hasMultiMonitor: boolean; updateError?: string | null | undefined;
}) {
    const isEditing = editingId === binding.id;
    const isInert = isBindingInert(binding);
    return (
        <div key={binding.id}>
            {/* Below sm the 44px action cluster stacks under the info block so it can't squeeze it; a row from sm. */}
            <div data-testid="channel-binding-row"
                className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-0 p-4 rounded-lg border ${isInert ? 'bg-danger/5 border-danger/30' : 'bg-panel/50 border-edge'}`}>
                <BindingInfo binding={binding} hasMultiMonitor={hasMultiMonitor} isInert={isInert} />
                <BindingActions binding={binding} isEditing={isEditing} isInert={isInert}
                    onToggleEdit={() => setEditingId(isEditing ? null : binding.id)}
                    onFix={() => setEditingId(binding.id)}
                    onDelete={onDelete} isDeleting={isDeleting} deletingId={deletingId} />
            </div>
            {isEditing && (
                <div className="mt-2">
                    <BindingConfigForm binding={binding} onSave={onSave} onCancel={() => setEditingId(null)}
                        isSaving={isUpdating} saveError={updateError} />
                </div>
            )}
        </div>
    );
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
    // Read when the PATCH settles: the promise callback's closure holds the render-time editingId.
    const editingRef = useRef<string | null>(null);
    const changeEditing = (id: string | null) => { editingRef.current = id; setEditingId(id); onEditingChange?.(id); };
    const handleSave = (id: string, dto: UpdateChannelBindingDto) => {
        setSavedId(id);
        const result: unknown = onUpdate(id, dto);
        if (!isThenable(result)) { changeEditing(null); return; }
        result.then(() => { if (editingRef.current === id) changeEditing(null); }).catch(() => {});
    };
    return { editingId, savedId, changeEditing, handleSave };
}

/**
 * Table of all channel bindings with inline editing, inert-binding repair, and delete.
 */
export function ChannelBindingList({ bindings, onUpdate, onDelete, isUpdating, isDeleting, updateError, onEditingChange }: ChannelBindingListProps) {
    const { editingId, savedId, changeEditing, handleSave } = useBindingEditor(onUpdate, onEditingChange);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const multiMonitorChannels = useMultiMonitorChannels(bindings);

    if (bindings.length === 0) {
        return (
            <div className="text-center py-12 text-muted">
                <p className="text-lg">No channel bindings configured</p>
                <p className="text-sm mt-1">Use the <code className="text-foreground bg-overlay px-1 py-0.5 rounded">/bind</code> command in Discord to set up channel bindings, or add one below.</p>
            </div>
        );
    }

    const handleDelete = (id: string) => { setDeletingId(id); onDelete(id); };

    return (
        <div className="space-y-3">
            {bindings.map((binding) => (
                <BindingRow key={binding.id} binding={binding} editingId={editingId} setEditingId={changeEditing}
                    onSave={handleSave} onDelete={handleDelete} isUpdating={isUpdating} isDeleting={isDeleting} deletingId={deletingId}
                    updateError={savedId === binding.id ? updateError : null}
                    hasMultiMonitor={binding.bindingPurpose === 'game-voice-monitor' && multiMonitorChannels.has(binding.channelId)} />
            ))}
        </div>
    );
}
