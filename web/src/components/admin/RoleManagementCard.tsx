import { useEffect, useRef, useState } from 'react';
import { useUserManagement } from '../../hooks/use-user-management';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useAuth } from '../../hooks/use-auth';
import { RoleBadge } from '../ui/role-badge';
import { InfiniteScrollSentinel } from '../ui/infinite-scroll-sentinel';
import { Modal } from '../ui/modal';
import { toast } from '../../lib/toast';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { UserRole, UserManagementDto } from '@raid-ledger/contract';

const SearchIcon = (
    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);

const TrashIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);

const ReactivateIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
);

const MoreVerticalIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
);

function UserAvatar({ username, avatarUrl }: { username: string; avatarUrl: string | null }) {
    return (
        <div className="w-8 h-8 rounded-full bg-overlay flex-shrink-0 overflow-hidden">
            {avatarUrl ? (
                <img src={avatarUrl} alt={username} className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />
            ) : null}
            <div className={`w-full h-full flex items-center justify-center text-dim text-xs font-bold ${avatarUrl ? 'hidden' : ''}`}>
                {username.charAt(0).toUpperCase()}
            </div>
        </div>
    );
}

function DeactivatedBadge() {
    return (
        <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-400/30">
            Deactivated
        </span>
    );
}

function UserActionMenu({ user, isCurrentUser, isDeactivated, onRemove, onReactivate, isPending }: {
    user: { id: number; username: string };
    isCurrentUser: boolean;
    isDeactivated: boolean;
    onRemove: (u: { id: number; username: string }) => void;
    onReactivate: (u: { id: number; username: string }) => void;
    isPending: boolean;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (isCurrentUser && !isDeactivated) return null;

    const handleAction = (fn: () => void) => { setOpen(false); fn(); };

    return (
        <div ref={rootRef} className="relative">
            <button type="button" onClick={() => setOpen((v) => !v)} disabled={isPending}
                aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${user.username}`}
                className="p-1.5 text-dim hover:text-foreground rounded-lg hover:bg-overlay transition-colors disabled:opacity-50">
                {MoreVerticalIcon}
            </button>
            {open && (
                <div role="menu" className="absolute right-0 top-full mt-1 z-10 min-w-[12rem] bg-panel border border-edge rounded-lg shadow-lg py-1">
                    {isDeactivated ? (
                        <button role="menuitem" onClick={() => handleAction(() => onReactivate({ id: user.id, username: user.username }))}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10 transition-colors">
                            {ReactivateIcon}
                            Reactivate user
                        </button>
                    ) : (
                        <button role="menuitem" onClick={() => handleAction(() => onRemove({ id: user.id, username: user.username }))}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                            {TrashIcon}
                            Remove user
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function UserRowActions({ user, isCurrentUser, isAdmin, isDeactivated, isDisabled, onRoleChange, onRemove, onReactivate, isRemoving, isReactivating }: {
    user: { id: number; username: string; role: string }; isCurrentUser: boolean; isAdmin: boolean;
    isDeactivated: boolean;
    isDisabled: boolean; onRoleChange: (id: number, name: string, role: Exclude<UserRole, 'admin'>) => void;
    onRemove: (u: { id: number; username: string }) => void;
    onReactivate: (u: { id: number; username: string }) => void;
    isRemoving: boolean; isReactivating: boolean;
}) {
    if (isAdmin) return <span className="text-xs text-dim px-3 py-1.5">Protected</span>;
    return (
        <>
            <select value={user.role} disabled={isDisabled}
                onChange={(e) => onRoleChange(user.id, user.username, e.target.value as Exclude<UserRole, 'admin'>)}
                className="text-sm bg-surface border border-edge rounded-lg px-3 py-1.5 text-foreground disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors">
                <option value="member">Member</option>
                <option value="operator">Operator</option>
            </select>
            <UserActionMenu user={{ id: user.id, username: user.username }} isCurrentUser={isCurrentUser}
                isDeactivated={isDeactivated} onRemove={onRemove} onReactivate={onReactivate}
                isPending={isRemoving || isReactivating} />
        </>
    );
}

function UserRow({ user, currentUserId, onRoleChange, onRemove, onReactivate, isUpdating, isRemoving, isReactivating }: {
    user: UserManagementDto;
    currentUserId: number | undefined; onRoleChange: (id: number, name: string, role: Exclude<UserRole, 'admin'>) => void;
    onRemove: (u: { id: number; username: string }) => void;
    onReactivate: (u: { id: number; username: string }) => void;
    isUpdating: boolean; isRemoving: boolean; isReactivating: boolean;
}) {
    const isCurrentUser = user.id === currentUserId;
    const isAdmin = user.role === 'admin';
    const isDeactivated = user.deactivatedAt !== null;
    const av = resolveAvatar(toAvatarUser(user));

    return (
        <div className="flex items-center gap-3 py-2.5">
            <UserAvatar username={user.username} avatarUrl={av.url} />
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-foreground truncate">{user.username}</span>
                <RoleBadge role={user.role} />
                {isDeactivated && <DeactivatedBadge />}
                {isCurrentUser && <span className="text-xs text-dim">(you)</span>}
            </div>
            <div className="ml-auto flex-shrink-0 flex items-center gap-2">
                <UserRowActions user={user} isCurrentUser={isCurrentUser} isAdmin={isAdmin}
                    isDeactivated={isDeactivated}
                    isDisabled={isCurrentUser || isAdmin || isUpdating}
                    onRoleChange={onRoleChange} onRemove={onRemove} onReactivate={onReactivate}
                    isRemoving={isRemoving} isReactivating={isReactivating} />
            </div>
        </div>
    );
}

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
    target: { id: number; username: string } | null; onClose: () => void; onConfirm: () => void; isPending: boolean;
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
 * Role Management Card for admin settings (ROK-272 AC-2, ROK-405).
 * Shows a searchable table of users with role dropdowns and removal action.
 */
function useRoleManagement() {
    const { user: currentUser } = useAuth();
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 300);
    const [removeTarget, setRemoveTarget] = useState<{ id: number; username: string } | null>(null);
    const { users, updateRole, removeUser, reactivateUser } = useUserManagement({ search: debouncedSearch || undefined });

    const handleRoleChange = async (userId: number, username: string, newRole: Exclude<UserRole, 'admin'>) => {
        try { await updateRole.mutateAsync({ userId, role: newRole }); toast.success(`${username} is now ${newRole === 'operator' ? 'an operator' : 'a member'}`); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update role'); }
    };

    const handleRemoveConfirm = async () => {
        if (!removeTarget) return;
        try { await removeUser.mutateAsync(removeTarget.id); toast.success('User removed'); setRemoveTarget(null); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to remove user'); }
    };

    const handleReactivate = async (target: { id: number; username: string }) => {
        try { await reactivateUser.mutateAsync(target.id); toast.success(`${target.username} reactivated`); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to reactivate user'); }
    };

    return { currentUser, search, setSearch, debouncedSearch, removeTarget, setRemoveTarget,
        users, updateRole, removeUser, reactivateUser, handleRoleChange, handleRemoveConfirm, handleReactivate };
}

function UserListSection({ h }: { h: ReturnType<typeof useRoleManagement> }) {
    const { items, isLoading, total, isFetchingNextPage, hasNextPage, sentinelRef } = h.users;

    return (
        <>
            {isLoading ? <TableSkeleton /> : items.length > 0 ? (
                <div className="divide-y divide-edge/30">
                    {items.map((u) => (
                        <UserRow key={u.id} user={u} currentUserId={h.currentUser?.id} onRoleChange={h.handleRoleChange}
                            onRemove={h.setRemoveTarget} onReactivate={h.handleReactivate}
                            isUpdating={h.updateRole.isPending} isRemoving={h.removeUser.isPending}
                            isReactivating={h.reactivateUser.isPending} />
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted text-center py-6">{h.debouncedSearch ? 'No users match your search' : 'No users found'}</p>
            )}
            {items.length > 0 && (
                <div className="mt-4 pt-3 border-t border-edge/30">
                    <span className="text-xs text-dim">{total} users</span>
                    <InfiniteScrollSentinel sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} />
                </div>
            )}
        </>
    );
}

/**
 * Role Management Card for admin settings (ROK-272 AC-2, ROK-405).
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
            <RemoveUserModal target={h.removeTarget} onClose={() => h.setRemoveTarget(null)} onConfirm={h.handleRemoveConfirm} isPending={h.removeUser.isPending} />
        </div>
    );
}
