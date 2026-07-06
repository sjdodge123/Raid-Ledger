import { useState } from 'react';
import { useUserManagement } from '../../hooks/use-user-management';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useAuth } from '../../hooks/use-auth';
import { InfiniteScrollSentinel } from '../ui/infinite-scroll-sentinel';
import { Modal } from '../ui/modal';
import { toast } from '../../lib/toast';
import { UserRow, type RowHandlers } from './UserManagementRow';
import { KickUserModal } from './KickUserModal';
import { BanUserModal } from './BanUserModal';
import type { ModerationTarget } from './moderation-shared';
import type { UserRole, KickUserDto, BanUserDto } from '@raid-ledger/contract';

const SearchIcon = (
    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

function TableSkeleton() {
    return (
        <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="animate-pulse flex items-center gap-3 py-2">
                    <div className="w-8 h-8 bg-overlay rounded-full" />
                    <div className="h-4 bg-overlay rounded w-32" />
                    <div className="ml-auto h-8 bg-overlay rounded w-28" />
                </div>
            ))}
        </div>
    );
}

function RemoveUserModal({ target, onClose, onConfirm, isPending }: {
    target: ModerationTarget | null; onClose: () => void; onConfirm: () => void; isPending: boolean;
}) {
    return (
        <Modal isOpen={!!target} onClose={onClose} title="Remove User">
            <div className="space-y-4">
                <p className="text-secondary">
                    Remove <strong className="text-foreground">{target?.username}</strong>? This permanently deletes their account and all associated data.
                </p>
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-sm text-red-400">
                        This action cannot be undone. Their characters, signups, and preferences will be permanently deleted. Events they created will be reassigned to you.
                    </p>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors">Cancel</button>
                    <button onClick={onConfirm} disabled={isPending}
                        className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors">
                        {isPending ? 'Removing...' : 'Remove'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

/**
 * Controller for the admin User Management card (ROK-272, ROK-405, ROK-1260, ROK-313).
 * Owns search + the destructive-action modal targets and their confirm handlers.
 * Toasts live here; the mutations + list live in useUserManagement.
 */
function useRoleManagement() {
    const { user: currentUser } = useAuth();
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 300);
    const [removeTarget, setRemoveTarget] = useState<ModerationTarget | null>(null);
    const [kickTarget, setKickTarget] = useState<ModerationTarget | null>(null);
    const [banTarget, setBanTarget] = useState<ModerationTarget | null>(null);
    const m = useUserManagement({ search: debouncedSearch || undefined });

    const runAction = async (p: Promise<unknown>, ok: string, fail: string, done?: () => void) => {
        try { await p; toast.success(ok); done?.(); }
        catch (err) { toast.error(err instanceof Error ? err.message : fail); }
    };

    const handlers = {
        onRoleChange: (userId: number, username: string, role: Exclude<UserRole, 'admin'>) =>
            runAction(m.updateRole.mutateAsync({ userId, role }), `${username} is now ${role === 'operator' ? 'an operator' : 'a member'}`, 'Failed to update role'),
        onRemoveConfirm: () => removeTarget &&
            runAction(m.removeUser.mutateAsync(removeTarget.id), 'User removed', 'Failed to remove user', () => setRemoveTarget(null)),
        onKickConfirm: (body: KickUserDto) => kickTarget &&
            runAction(m.kickUser.mutateAsync({ userId: kickTarget.id, body }), `${kickTarget.username} kicked`, 'Failed to kick user', () => setKickTarget(null)),
        onBanConfirm: (body: BanUserDto) => banTarget &&
            runAction(m.banUser.mutateAsync({ userId: banTarget.id, body }), `${banTarget.username} banned`, 'Failed to ban user', () => setBanTarget(null)),
        row: {
            onRemove: setRemoveTarget,
            onKick: setKickTarget,
            onBan: setBanTarget,
            onReactivate: (t: ModerationTarget) => runAction(m.reactivateUser.mutateAsync(t.id), `${t.username} reactivated`, 'Failed to reactivate user'),
            onUnkick: (t: ModerationTarget) => runAction(m.unkickUser.mutateAsync(t.id), `${t.username} unkicked`, 'Failed to unkick user'),
            onUnban: (t: ModerationTarget) => runAction(m.unbanUser.mutateAsync(t.id), `${t.username} unbanned`, 'Failed to unban user'),
        } satisfies RowHandlers,
    };

    return { currentUser, search, setSearch, debouncedSearch, m,
        removeTarget, setRemoveTarget, kickTarget, setKickTarget, banTarget, setBanTarget, handlers };
}

type RoleManagement = ReturnType<typeof useRoleManagement>;

function UserListSection({ h }: { h: RoleManagement }) {
    const { items, isLoading, total, isFetchingNextPage, hasNextPage, sentinelRef } = h.m.users;
    const isBusy = h.m.removeUser.isPending || h.m.reactivateUser.isPending
        || h.m.kickUser.isPending || h.m.unkickUser.isPending || h.m.banUser.isPending || h.m.unbanUser.isPending;

    if (isLoading) return <TableSkeleton />;
    if (items.length === 0) {
        return <p className="text-sm text-muted text-center py-6">{h.debouncedSearch ? 'No users match your search' : 'No users found'}</p>;
    }
    return (
        <>
            <div className="divide-y divide-edge/30">
                {items.map((u) => (
                    <UserRow key={u.id} user={u} currentUserId={h.currentUser?.id} onRoleChange={h.handlers.onRoleChange}
                        handlers={h.handlers.row} isUpdating={h.m.updateRole.isPending} isBusy={isBusy} />
                ))}
            </div>
            <div className="mt-4 pt-3 border-t border-edge/30">
                <span className="text-xs text-dim">{total} users</span>
                <InfiniteScrollSentinel sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} />
            </div>
        </>
    );
}

/**
 * Role Management Card for admin settings (ROK-272 AC-2, ROK-405, ROK-313).
 */
export function RoleManagementCard() {
    const h = useRoleManagement();

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">User Management</h3>
                    <p className="text-sm text-muted mt-0.5">Promote members to operator or demote operators back to member</p>
                </div>
            </div>
            <div className="relative mb-4">
                {SearchIcon}
                <input type="text" value={h.search} onChange={(e) => h.setSearch(e.target.value)} placeholder="Search users..."
                    className="w-full pl-10 pr-4 py-2 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all" />
            </div>
            <UserListSection h={h} />
            <RemoveUserModal target={h.removeTarget} onClose={() => h.setRemoveTarget(null)} onConfirm={h.handlers.onRemoveConfirm} isPending={h.m.removeUser.isPending} />
            <KickUserModal key={h.kickTarget?.id ?? 'kick-none'} target={h.kickTarget}
                onClose={() => h.setKickTarget(null)} onConfirm={h.handlers.onKickConfirm} isPending={h.m.kickUser.isPending} />
            <BanUserModal key={h.banTarget?.id ?? 'ban-none'} target={h.banTarget}
                onClose={() => h.setBanTarget(null)} onConfirm={h.handlers.onBanConfirm} isPending={h.m.banUser.isPending} />
        </div>
    );
}
