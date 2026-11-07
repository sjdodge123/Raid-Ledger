/**
 * ROK-2106 — one compact binding row inside a channel group: purpose chip,
 * INERT flag, `game · purpose` line and the per-binding actions (Fix / Edit /
 * Remove) with its inline editor. The channel name, icon and lifecycle chips
 * live on the group header (`ChannelBindingGroupCard`).
 */
import type { JSX } from 'react';
import type { ChannelBindingDto, UpdateChannelBindingDto } from '@raid-ledger/contract';
import { classifyBindingTriple } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { BindingConfigForm } from './BindingConfigForm';

const BEHAVIOR_LABELS: Record<string, string> = {
    'game-announcements': 'Event Announcements',
    'game-voice-monitor': 'Quick Play Events (Activity Monitoring) & Game Event Announcements',
    'general-lobby': 'General Lobby',
    'quick-play-announcements': 'Quick Play Announcements',
    'lfg-board': 'LFG Board',
};

const BEHAVIOR_BADGES: Record<string, { label: string; className: string }> = {
    'game-announcements': { label: 'Announcements', className: 'bg-cyan-500/15 text-cyan-400' },
    'game-voice-monitor': { label: 'Activity Monitor', className: 'bg-purple-500/15 text-purple-400' },
    'general-lobby': { label: 'General Lobby', className: 'bg-amber-500/15 text-amber-400' },
    'quick-play-announcements': { label: 'Quick Play', className: 'bg-teal-500/15 text-teal-400' },
    'lfg-board': { label: 'LFG Board', className: 'bg-indigo-500/15 text-indigo-400' },
};

/** ROK-1415/1416: any triple the shared classifier rejects renders as INERT. */
function isBindingInert(binding: ChannelBindingDto): boolean {
    return classifyBindingTriple(binding.channelType, binding.bindingPurpose, binding.gameId) != null;
}

function BindingBadge({ purpose }: { purpose: string }): JSX.Element | null {
    const badge = BEHAVIOR_BADGES[purpose];
    if (!badge) return null;
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${badge.className}`}>{badge.label}</span>;
}

/** Status tone on the danger tokens (design-system §4.7) so it reads in both colour families. */
function InertBadge(): JSX.Element {
    return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-danger/10 text-danger border border-danger/30">
            ⚠ INERT — Quick Play can&apos;t fire
        </span>
    );
}

function BindingInfo({ binding, isInert }: { binding: ChannelBindingDto; isInert: boolean }): JSX.Element {
    return (
        <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
                <BindingBadge purpose={binding.bindingPurpose} />
                {isInert && <InertBadge />}
            </div>
            <p className="text-xs text-muted mt-1 break-words">
                {binding.gameName ? binding.gameName : 'All games'}{' · '}{BEHAVIOR_LABELS[binding.bindingPurpose] ?? binding.bindingPurpose}
            </p>
        </div>
    );
}

interface BindingActionsProps {
    binding: ChannelBindingDto; isEditing: boolean; isInert: boolean; onToggleEdit: () => void; onFix: () => void;
    onDelete: (id: string) => void; isRemoving: boolean;
}

function BindingActions({ binding, isEditing, isInert, onToggleEdit, onFix, onDelete, isRemoving }: BindingActionsProps): JSX.Element {
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

/** Per-row state the list scopes to this binding (editor, save, delete). */
export interface ChannelBindingRowProps {
    binding: ChannelBindingDto;
    isEditing: boolean;
    setEditingId: (id: string | null) => void;
    onSave: (id: string, dto: UpdateChannelBindingDto) => void;
    onDelete: (id: string) => void;
    isSaving: boolean;
    saveLocked: boolean;
    isRemoving: boolean;
    updateError?: string | null | undefined;
}

/** One binding: compact row + its inline editor when open. */
export function ChannelBindingRow(props: ChannelBindingRowProps): JSX.Element {
    const { binding, isEditing, setEditingId } = props;
    const isInert = isBindingInert(binding);
    const tone = isInert ? 'bg-danger/5 border-danger/30' : 'bg-surface border-edge';
    return (
        <div>
            {/* Below sm the 44px action cluster stacks under the info block so it can't squeeze it; a row from sm. */}
            <div data-testid="channel-binding-row"
                className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-3 rounded-md border ${tone}`}>
                <BindingInfo binding={binding} isInert={isInert} />
                <BindingActions binding={binding} isEditing={isEditing} isInert={isInert}
                    onToggleEdit={() => setEditingId(isEditing ? null : binding.id)}
                    onFix={() => setEditingId(binding.id)} onDelete={props.onDelete} isRemoving={props.isRemoving} />
            </div>
            {isEditing && (
                <div className="mt-2">
                    <BindingConfigForm binding={binding} onSave={props.onSave} onCancel={() => setEditingId(null)}
                        isSaving={props.isSaving} saveLocked={props.saveLocked} saveError={props.updateError} />
                </div>
            )}
        </div>
    );
}
