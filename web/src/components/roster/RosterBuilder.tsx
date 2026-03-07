import React, { memo } from 'react';
import type { RosterAssignmentResponse, RosterRole, PugSlotResponseDto } from '@raid-ledger/contract';
import { RosterSlot } from './RosterSlot';
import { UnassignedBar } from './UnassignedBar';
import { AssignmentPopup } from './AssignmentPopup';
import { PugCard } from '../pugs/pug-card';
import type { AvailableSlot } from './AssignmentPopup';
import { Modal } from '../ui/modal';
import { RoleIcon } from '../shared/RoleIcon';
import { useAriaLive } from '../../hooks/use-aria-live';
import { useRosterActions } from './use-roster-actions';

interface RosterBuilderProps {
    pool: RosterAssignmentResponse[];
    assignments: RosterAssignmentResponse[];
    slots?: { tank?: number; healer?: number; dps?: number; flex?: number; player?: number; bench?: number };
    onRosterChange: (pool: RosterAssignmentResponse[], assignments: RosterAssignmentResponse[], characterIdMap?: Map<number, string>) => void;
    canEdit: boolean;
    onSlotClick?: (role: RosterRole, position: number) => void;
    canJoin?: boolean;
    signupSucceeded?: boolean;
    currentUserId?: number;
    onSelfRemove?: () => void;
    stickyExtra?: React.ReactNode;
    onGenerateInviteLink?: (role: RosterRole) => void;
    pugs?: PugSlotResponseDto[];
    onRemovePug?: (pugId: string) => void;
    onEditPug?: (pug: PugSlotResponseDto) => void;
    onRegeneratePugLink?: (pugId: string) => void;
    eventId?: number;
    onRemoveFromEvent?: (signupId: number, username: string) => void;
    gameId?: number;
    isMMOEvent?: boolean;
}

const MMO_ROLE_SLOTS: { role: RosterRole; count: number; label: string; color: string }[] = [
    { role: 'tank', count: 2, label: 'Tank', color: 'bg-blue-600' },
    { role: 'healer', count: 4, label: 'Healer', color: 'bg-green-600' },
    { role: 'dps', count: 14, label: 'DPS', color: 'bg-red-600' },
    { role: 'flex', count: 5, label: 'Flex', color: 'bg-purple-600' },
];

const GENERIC_ROLE_SLOTS: { role: RosterRole; count: number; label: string; color: string }[] = [
    { role: 'player', count: 4, label: 'Player', color: 'bg-indigo-600' },
];

const BENCH_SLOT = { role: 'bench' as RosterRole, count: 0, label: 'Bench', color: 'bg-faint' };

function useRosterSlots(slots: RosterBuilderProps['slots']) {
    const isGenericGame = React.useMemo(() => {
        if (!slots) return false;
        return (slots.player ?? 0) > 0 && !((slots.tank ?? 0) > 0 || (slots.healer ?? 0) > 0 || (slots.dps ?? 0) > 0 || (slots.flex ?? 0) > 0);
    }, [slots]);

    const roleSlots = React.useMemo(() => {
        const result = isGenericGame ? [...GENERIC_ROLE_SLOTS] : [...MMO_ROLE_SLOTS];
        result.push({ ...BENCH_SLOT, count: slots?.bench ?? 0 });
        return result;
    }, [isGenericGame, slots]);

    const getSlotCount = React.useCallback((role: RosterRole): number => {
        if (slots?.[role] !== undefined) return slots[role]!;
        return roleSlots.find((s) => s.role === role)?.count ?? 0;
    }, [slots, roleSlots]);

    return { isGenericGame, roleSlots, getSlotCount };
}

function useAvailableSlots(roleSlots: { role: RosterRole; label: string; color: string }[], assignments: RosterAssignmentResponse[], getSlotCount: (r: RosterRole) => number) {
    return React.useMemo<AvailableSlot[]>(() => {
        const result: AvailableSlot[] = [];
        for (const { role, label, color } of roleSlots) {
            const count = getSlotCount(role);
            for (let i = 1; i <= count; i++) {
                const occupant = assignments.find(a => a.slot === role && a.position === i);
                result.push({ role, position: i, label, color, occupantName: occupant?.username });
            }
        }
        return result;
    }, [roleSlots, assignments, getSlotCount]);
}

function AdminButtons({ pool, allSlotsFilled, assignmentCount, actions }: {
    pool: RosterAssignmentResponse[]; allSlotsFilled: boolean; assignmentCount: number;
    actions: ReturnType<typeof useRosterActions>;
}) {
    return (
        <div className="flex items-center gap-2">
            <button type="button" className="btn btn-secondary btn-sm flex-1 md:flex-none" disabled={pool.length === 0 || allSlotsFilled || actions.isBulkUpdating} onClick={actions.handleAutoFillClick}>
                {actions.isBulkUpdating ? <><svg className="inline-block mr-1 h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>Updating...</> : 'Auto-Fill'}
            </button>
            <button type="button" className={`btn btn-danger btn-sm flex-1 md:flex-none ${actions.clearPending ? 'animate-pulse' : ''}`} disabled={assignmentCount === 0 || actions.isBulkUpdating} onClick={actions.handleClearAllClick}>
                {actions.clearPending ? 'Click again to clear' : 'Clear All'}
            </button>
        </div>
    );
}

function usePendingSlot(signupSucceeded: boolean) {
    const [pendingSlotKey, setPendingSlotKey] = React.useState<string | null>(null);
    React.useEffect(() => { if (pendingSlotKey) { const t = setTimeout(() => setPendingSlotKey(null), 3000); return () => clearTimeout(t); } }, [pendingSlotKey]);
    React.useEffect(() => { if (signupSucceeded && pendingSlotKey) setPendingSlotKey(null); }, [signupSucceeded, pendingSlotKey]);
    return { pendingSlotKey, setPendingSlotKey };
}

function useAllSlotsFilled(roleSlots: { role: RosterRole }[], assignments: RosterAssignmentResponse[], getSlotCount: (r: RosterRole) => number) {
    return React.useMemo(() =>
        roleSlots.every(({ role }) => { const count = getSlotCount(role); return count === 0 || assignments.filter(a => a.slot === role).length >= count; }),
        [roleSlots, assignments, getSlotCount]);
}

function RosterAssignmentPopup({ actions, pool, assignments, eventId, canSelfAssign, onSlotClick, availableSlots, onGenerateInviteLink, onRemoveFromEvent, gameId, isMMOEvent, currentUserId }: {
    actions: ReturnType<typeof useRosterActions>; pool: RosterAssignmentResponse[]; assignments: RosterAssignmentResponse[];
    eventId?: number; canSelfAssign: boolean; onSlotClick?: (role: RosterRole, position: number) => void;
    availableSlots: AvailableSlot[]; onGenerateInviteLink?: (role: RosterRole) => void;
    onRemoveFromEvent?: (signupId: number, username: string) => void; gameId?: number; isMMOEvent?: boolean; currentUserId?: number;
}) {
    const handleSelfAssign = () => {
        if (!actions.assignmentTarget || !onSlotClick) return;
        onSlotClick(actions.assignmentTarget.role, actions.assignmentTarget.position);
        actions.setAssignmentTarget(null);
    };
    return (
        <AssignmentPopup isOpen={actions.assignmentTarget !== null || actions.browseAll} onClose={actions.handleClosePopup} eventId={eventId ?? 0}
            slotRole={actions.assignmentTarget?.role ?? null} slotPosition={actions.assignmentTarget?.position ?? 0}
            unassigned={pool} currentOccupant={actions.assignmentTarget?.occupant}
            onAssign={actions.handleAssign} onRemove={actions.assignmentTarget?.occupant ? actions.handleRemoveFromSlot : undefined}
            onSelfAssign={canSelfAssign ? handleSelfAssign : undefined} availableSlots={availableSlots}
            onAssignToSlot={actions.handleAssignToSlot}
            onGenerateInviteLink={onGenerateInviteLink && actions.assignmentTarget ? () => onGenerateInviteLink(actions.assignmentTarget!.role) : undefined}
            onRemoveFromEvent={onRemoveFromEvent} onReassignToSlot={actions.handleReassignToSlot}
            assigned={assignments} gameId={gameId} isMMO={isMMOEvent}
            currentUserId={currentUserId} onSelfSlotClick={onSlotClick} />
    );
}

function useRosterBuilderData(props: RosterBuilderProps) {
    const { pool, assignments, slots, onRosterChange, signupSucceeded = false, currentUserId, pugs = [] } = props;
    const { announce } = useAriaLive();
    const { pendingSlotKey, setPendingSlotKey } = usePendingSlot(signupSucceeded);
    const { isGenericGame, roleSlots, getSlotCount } = useRosterSlots(slots);
    const actions = useRosterActions({ pool, assignments, onRosterChange, roleSlots, getSlotCount, isGenericGame, announce });
    const availableSlots = useAvailableSlots(roleSlots, assignments, getSlotCount);
    const allSlotsFilled = useAllSlotsFilled(roleSlots, assignments, getSlotCount);
    const isCurrentUserInRoster = currentUserId != null && (pool.some(p => p.userId === currentUserId) || assignments.some(a => a.userId === currentUserId));
    const activePugs = pugs.filter(p => p.status === 'pending' || p.status === 'invited');
    return { pendingSlotKey, setPendingSlotKey, isGenericGame, roleSlots, getSlotCount, actions, availableSlots, allSlotsFilled, isCurrentUserInRoster, activePugs };
}

export const RosterBuilder = memo(function RosterBuilder(props: RosterBuilderProps) {
    const { pool, assignments, canEdit, onSlotClick, canJoin = false, currentUserId, onSelfRemove, stickyExtra, onGenerateInviteLink, onRemovePug, onEditPug, onRegeneratePugLink, eventId, onRemoveFromEvent, gameId, isMMOEvent } = props;
    const d = useRosterBuilderData(props);

    return (
        <div className="space-y-4">
            <UnassignedBarSection pool={pool} canEdit={canEdit} stickyExtra={stickyExtra} onBrowseAll={() => d.actions.setBrowseAll(true)} />
            {canEdit && <AdminButtons pool={pool} allSlotsFilled={d.allSlotsFilled} assignmentCount={assignments.length} actions={d.actions} />}
            <AutoFillModal preview={d.actions.autoFillPreview} onClose={() => d.actions.setAutoFillPreview(null)} onConfirm={d.actions.handleAutoFillConfirm} />
            {d.activePugs.length > 0 && <PugInvitesBar pugs={d.activePugs} onRemovePug={onRemovePug} onEditPug={onEditPug} onRegeneratePugLink={onRegeneratePugLink} />}
            <RoleSlotGrid roleSlots={d.roleSlots} assignments={assignments} getSlotCount={d.getSlotCount}
                isGenericGame={d.isGenericGame} canEdit={canEdit} canJoin={canJoin} currentUserId={currentUserId}
                onSlotClick={onSlotClick} onSelfRemove={onSelfRemove} onAdminClick={d.actions.handleAdminSlotClick}
                onRemove={d.actions.handleRemoveFromSlot} pendingSlotKey={d.pendingSlotKey} setPendingSlotKey={d.setPendingSlotKey} />
            <RosterAssignmentPopup actions={d.actions} pool={pool} assignments={assignments} eventId={eventId}
                canSelfAssign={!!(canEdit && !d.isCurrentUserInRoster && currentUserId != null && onSlotClick)}
                onSlotClick={onSlotClick} availableSlots={d.availableSlots} onGenerateInviteLink={onGenerateInviteLink}
                onRemoveFromEvent={onRemoveFromEvent} gameId={gameId} isMMOEvent={isMMOEvent} currentUserId={currentUserId} />
        </div>
    );
});

function UnassignedBarSection({ pool, canEdit, stickyExtra, onBrowseAll }: { pool: RosterAssignmentResponse[]; canEdit: boolean; stickyExtra?: React.ReactNode; onBrowseAll: () => void }) {
    if (stickyExtra) {
        return (
            <div className="flex flex-col md:flex-row gap-2 items-stretch md:sticky md:top-28" style={{ zIndex: 20 }}>
                <div className="flex-1 min-w-0"><UnassignedBar pool={pool} onBarClick={canEdit ? onBrowseAll : undefined} inline /></div>
                <div className="flex-1 min-w-0">{stickyExtra}</div>
            </div>
        );
    }
    return <UnassignedBar pool={pool} onBarClick={canEdit ? onBrowseAll : undefined} />;
}

function AutoFillModal({ preview, onClose, onConfirm }: { preview: import('./roster-auto-fill').AutoFillResult | null; onClose: () => void; onConfirm: () => void }) {
    return (
        <Modal isOpen={preview !== null} onClose={onClose} title="Auto-Fill Roster">
            {preview && (
                <div className="space-y-4">
                    <p className="text-sm text-secondary">Auto-fill will assign <strong className="text-foreground">{preview.totalFilled}</strong> players to roster slots:</p>
                    <ul className="space-y-1 text-sm">{preview.summary.map(({ role, count }) => <li key={role} className="flex items-center gap-2"><span className="font-medium text-foreground">{count}</span><span className="text-secondary">{'\u2192'} {role}</span></li>)}</ul>
                    {preview.newPool.length > 0 && <p className="text-xs text-dim">{preview.newPool.length} player{preview.newPool.length !== 1 ? 's' : ''} will remain unassigned</p>}
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={onConfirm}>Continue</button>
                    </div>
                </div>
            )}
        </Modal>
    );
}

function PugInvitesBar({ pugs, onRemovePug, onEditPug, onRegeneratePugLink }: { pugs: PugSlotResponseDto[]; onRemovePug?: (id: string) => void; onEditPug?: (pug: PugSlotResponseDto) => void; onRegeneratePugLink?: (id: string) => void }) {
    return (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-900/10 p-3">
            <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-400"><span className="inline-block h-2.5 w-2.5 rounded bg-amber-500" />Guest Invites ({pugs.length})</h4>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {pugs.map((pug) => <PugCard key={pug.id} pug={pug} canManage={!!onRemovePug} onEdit={onEditPug} onRemove={onRemovePug} onRegenerateLink={onRegeneratePugLink} />)}
            </div>
        </div>
    );
}

interface RoleSlotGridProps {
    roleSlots: { role: RosterRole; count: number; label: string; color: string }[];
    assignments: RosterAssignmentResponse[]; getSlotCount: (role: RosterRole) => number;
    isGenericGame: boolean; canEdit: boolean; canJoin: boolean;
    currentUserId?: number; onSlotClick?: (role: RosterRole, position: number) => void;
    onSelfRemove?: () => void; onAdminClick: (role: RosterRole, position: number) => void;
    onRemove: (signupId: number) => void;
    pendingSlotKey: string | null; setPendingSlotKey: (k: string | null) => void;
}

function roleGroupLabel(role: RosterRole, label: string, isGeneric: boolean) {
    return isGeneric && role === 'player' ? 'Players' : label;
}

function RoleGroup({ role, label, color, assigned, count, isGenericGame, canEdit, canJoin, currentUserId, onSlotClick, onSelfRemove, onAdminClick, onRemove, pendingSlotKey, setPendingSlotKey }: {
    role: RosterRole; label: string; color: string; assigned: RosterAssignmentResponse[]; count: number;
} & Omit<RoleSlotGridProps, 'roleSlots' | 'assignments' | 'getSlotCount'>) {
    return (
        <div className="rounded-lg border border-edge bg-surface/50 p-2 sm:p-4">
            <h4 className="mb-2 sm:mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-secondary">
                <RoleIcon role={role} size="w-4 h-4" />
                {roleGroupLabel(role, label, isGenericGame)} ({role === 'bench' ? assigned.length : `${assigned.length}/${count}`})
            </h4>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: count }, (_, i) => {
                    const position = i + 1;
                    const item = assigned.find((a) => a.position === position);
                    return (
                        <RosterSlot key={`slot-${role}-${position}`} role={role} position={position} item={item} color={color}
                            onJoinClick={canJoin && !item ? onSlotClick : undefined}
                            isCurrentUser={currentUserId != null && item?.userId === currentUserId}
                            onAdminClick={canEdit ? onAdminClick : undefined} onRemove={canEdit ? onRemove : undefined}
                            onSelfRemove={!canEdit && onSelfRemove && currentUserId != null && item?.userId === currentUserId ? onSelfRemove : undefined}
                            isPending={pendingSlotKey === `${role}-${position}`}
                            onPendingChange={(pending) => setPendingSlotKey(pending ? `${role}-${position}` : null)} />
                    );
                })}
            </div>
        </div>
    );
}

function RoleSlotGrid(props: RoleSlotGridProps) {
    const { roleSlots, assignments, getSlotCount, ...rest } = props;
    return (
        <div className="space-y-2 sm:space-y-4">
            {roleSlots.map(({ role, label, color }) => {
                const configuredCount = getSlotCount(role);
                const assigned = assignments.filter((a) => a.slot === role);
                const count = role === 'bench' ? Math.max(configuredCount, assigned.length + 1) : configuredCount;
                if (count === 0) return null;
                return <RoleGroup key={role} role={role} label={label} color={color} assigned={assigned} count={count} {...rest} />;
            })}
        </div>
    );
}
