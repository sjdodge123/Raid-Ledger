import { useState } from 'react';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';
import { classifyBindingTriple } from '@raid-ledger/contract';
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

function InertBadge() {
    return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-600/40 text-red-100">
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
    return (
        <div className="flex items-center gap-2 flex-shrink-0">
            {isInert && !isEditing && (
                <button onClick={onFix} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
                    Fix &rarr;
                </button>
            )}
            <button onClick={onToggleEdit} className="px-3 py-1.5 text-xs bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors">
                {isEditing ? 'Close' : 'Edit'}
            </button>
            <button onClick={() => onDelete(binding.id)} disabled={isDeleting && deletingId === binding.id}
                className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors disabled:opacity-50">
                {isDeleting && deletingId === binding.id ? 'Removing...' : 'Remove'}
            </button>
        </div>
    );
}

function BindingRow({ binding, editingId, setEditingId, onSave, onDelete, isUpdating, isDeleting, deletingId, hasMultiMonitor, updateError }: {
    binding: ChannelBindingDto; editingId: string | null; setEditingId: (id: string | null) => void;
    onSave: (id: string, dto: UpdateChannelBindingDto) => void; onDelete: (id: string) => void;
    isUpdating: boolean; isDeleting: boolean; deletingId: string | null; hasMultiMonitor: boolean; updateError?: string | null;
}) {
    const isEditing = editingId === binding.id;
    const isInert = isBindingInert(binding);
    return (
        <div key={binding.id}>
            <div className={`flex items-center justify-between p-4 rounded-lg border ${isInert ? 'bg-red-500/5 border-red-500/30' : 'bg-panel/50 border-edge'}`}>
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

/**
 * Table of all channel bindings with inline editing, inert-binding repair, and delete.
 */
export function ChannelBindingList({ bindings, onUpdate, onDelete, isUpdating, isDeleting, updateError }: ChannelBindingListProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
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
    // ROK-1416: collapse the row only once the PATCH resolves so a rejected save
    // (400/409) keeps the form open with its error instead of vanishing. A void
    // return (unit tests / fire-and-forget) closes synchronously as before.
    const handleSave = (id: string, dto: UpdateChannelBindingDto) => {
        const result: unknown = onUpdate(id, dto);
        if (result && typeof (result as { then?: unknown }).then === 'function') {
            (result as Promise<unknown>).then(() => setEditingId(null)).catch(() => {});
        } else {
            setEditingId(null);
        }
    };

    return (
        <div className="space-y-3">
            {bindings.map((binding) => (
                <BindingRow key={binding.id} binding={binding} editingId={editingId} setEditingId={setEditingId}
                    onSave={handleSave} onDelete={handleDelete} isUpdating={isUpdating} isDeleting={isDeleting} deletingId={deletingId}
                    updateError={updateError}
                    hasMultiMonitor={binding.bindingPurpose === 'game-voice-monitor' && multiMonitorChannels.has(binding.channelId)} />
            ))}
        </div>
    );
}
