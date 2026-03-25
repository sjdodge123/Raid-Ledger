import { useMemo, useState } from 'react';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';
import { BindingConfigForm } from './BindingConfigForm';

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
  onUpdate: (id: string, dto: UpdateChannelBindingDto) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
  isDeleting: boolean;
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

function MultiMonitorWarning() {
    return (
        <p className="text-xs text-amber-400 mt-1">
            Multiple game monitors on this channel. Scheduled events for one game will suppress Quick Play for all.
        </p>
    );
}

function BindingInfo({ binding, hasMultiMonitor }: { binding: ChannelBindingDto; hasMultiMonitor: boolean }) {
    return (
        <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0"><ChannelTypeIcon type={binding.channelType} /></div>
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">#{binding.channelName ?? binding.channelId}</span>
                    <BindingBadge purpose={binding.bindingPurpose} />
                </div>
                <p className="text-xs text-muted mt-0.5">
                    {binding.gameName ? binding.gameName : 'All games'}{' \u00B7 '}{BEHAVIOR_LABELS[binding.bindingPurpose] ?? binding.bindingPurpose}
                </p>
                {hasMultiMonitor && <MultiMonitorWarning />}
            </div>
        </div>
    );
}

function BindingActions({ binding, isEditing, onToggleEdit, onDelete, isDeleting, deletingId }: {
    binding: ChannelBindingDto; isEditing: boolean; onToggleEdit: () => void;
    onDelete: (id: string) => void; isDeleting: boolean; deletingId: string | null;
}) {
    return (
        <div className="flex items-center gap-2 flex-shrink-0">
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

function BindingRow({ binding, editingId, setEditingId, onSave, onDelete, isUpdating, isDeleting, deletingId, hasMultiMonitor }: {
    binding: ChannelBindingDto; editingId: string | null; setEditingId: (id: string | null) => void;
    onSave: (id: string, dto: UpdateChannelBindingDto) => void; onDelete: (id: string) => void;
    isUpdating: boolean; isDeleting: boolean; deletingId: string | null; hasMultiMonitor: boolean;
}) {
    return (
        <div key={binding.id}>
            <div className="flex items-center justify-between p-4 bg-panel/50 rounded-lg border border-border">
                <BindingInfo binding={binding} hasMultiMonitor={hasMultiMonitor} />
                <BindingActions binding={binding} isEditing={editingId === binding.id}
                    onToggleEdit={() => setEditingId(editingId === binding.id ? null : binding.id)}
                    onDelete={onDelete} isDeleting={isDeleting} deletingId={deletingId} />
            </div>
            {editingId === binding.id && (
                <div className="mt-2">
                    <BindingConfigForm binding={binding} onSave={onSave} onCancel={() => setEditingId(null)} isSaving={isUpdating} />
                </div>
            )}
        </div>
    );
}

/**
 * Table of all channel bindings with inline editing and delete.
 */
export function ChannelBindingList({ bindings, onUpdate, onDelete, isUpdating, isDeleting }: ChannelBindingListProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const multiMonitorChannels = useMemo(() => {
        const counts = new Map<string, number>();
        for (const b of bindings) {
            if (b.bindingPurpose !== 'game-voice-monitor') continue;
            counts.set(b.channelId, (counts.get(b.channelId) ?? 0) + 1);
        }
        const result = new Set<string>();
        for (const [chId, count] of counts) {
            if (count >= 2) result.add(chId);
        }
        return result;
    }, [bindings]);

    if (bindings.length === 0) {
        return (
            <div className="text-center py-12 text-muted">
                <p className="text-lg">No channel bindings configured</p>
                <p className="text-sm mt-1">Use the <code className="text-foreground bg-overlay px-1 py-0.5 rounded">/bind</code> command in Discord to set up channel bindings, or add one below.</p>
            </div>
        );
    }

    const handleDelete = (id: string) => { setDeletingId(id); onDelete(id); };
    const handleSave = (id: string, dto: UpdateChannelBindingDto) => { onUpdate(id, dto); setEditingId(null); };

    return (
        <div className="space-y-3">
            {bindings.map((binding) => (
                <BindingRow key={binding.id} binding={binding} editingId={editingId} setEditingId={setEditingId}
                    onSave={handleSave} onDelete={handleDelete} isUpdating={isUpdating} isDeleting={isDeleting} deletingId={deletingId}
                    hasMultiMonitor={binding.bindingPurpose === 'game-voice-monitor' && multiMonitorChannels.has(binding.channelId)} />
            ))}
        </div>
    );
}
