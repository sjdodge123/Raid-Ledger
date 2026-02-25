import { useState } from 'react';
import { useUserManagement } from '../../hooks/use-user-management';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useAuth } from '../../hooks/use-auth';
import { RoleBadge } from '../ui/role-badge';
import { InfiniteScrollSentinel } from '../ui/infinite-scroll-sentinel';
import { Modal } from '../ui/modal';
import { toast } from '../../lib/toast';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { UserRole } from '@raid-ledger/contract';

/**
 * Role Management Card for admin settings (ROK-272 AC-2, ROK-405).
 * Shows a searchable table of users with role dropdowns and removal action.
 * Admin can promote/demote between member and operator, and remove non-admin members.
 */
export function RoleManagementCard() {
    const { user: currentUser } = useAuth();
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 300);
    const [removeTarget, setRemoveTarget] = useState<{ id: number; username: string } | null>(null);

    const { users, updateRole, removeUser } = useUserManagement({
        search: debouncedSearch || undefined,
    });

    const { items, isLoading, total, isFetchingNextPage, hasNextPage, sentinelRef } = users;

    const handleRoleChange = async (userId: number, username: string, newRole: Exclude<UserRole, 'admin'>) => {
        try {
            await updateRole.mutateAsync({ userId, role: newRole });
            toast.success(`${username} is now ${newRole === 'operator' ? 'an operator' : 'a member'}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update role');
        }
    };

    const handleRemoveConfirm = async () => {
        if (!removeTarget) return;
        try {
            await removeUser.mutateAsync(removeTarget.id);
            toast.success('User removed');
            setRemoveTarget(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to remove user');
        }
    };

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">User Management</h3>
                    <p className="text-sm text-muted mt-0.5">
                        Promote members to operator or demote operators back to member
                    </p>
                </div>
            </div>

            {/* Search */}
            <div className="relative mb-4">
                <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dim"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                </svg>
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search users..."
                    className="w-full pl-10 pr-4 py-2 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="animate-pulse flex items-center gap-3 py-2">
                            <div className="w-8 h-8 bg-overlay rounded-full" />
                            <div className="h-4 bg-overlay rounded w-32" />
                            <div className="ml-auto h-8 bg-overlay rounded w-28" />
                        </div>
                    ))}
                </div>
            ) : items.length > 0 ? (
                <div className="divide-y divide-edge/30">
                    {items.map((u) => {
                        const isCurrentUser = u.id === currentUser?.id;
                        const isAdmin = u.role === 'admin';
                        const isDisabled = isCurrentUser || isAdmin || updateRole.isPending;

                        return (
                            <div
                                key={u.id}
                                className="flex items-center gap-3 py-2.5"
                            >
                                {/* Avatar */}
                                {(() => {
                                    const av = resolveAvatar(toAvatarUser(u));
                                    return (
                                        <div className="w-8 h-8 rounded-full bg-overlay flex-shrink-0 overflow-hidden">
                                            {av.url ? (
                                                <img
                                                    src={av.url}
                                                    alt={u.username}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                                    }}
                                                />
                                            ) : null}
                                            <div className={`w-full h-full flex items-center justify-center text-dim text-xs font-bold ${av.url ? 'hidden' : ''}`}>
                                                {u.username.charAt(0).toUpperCase()}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Username + Badge */}
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm text-foreground truncate">
                                        {u.username}
                                    </span>
                                    <RoleBadge role={u.role} />
                                    {isCurrentUser && (
                                        <span className="text-xs text-dim">(you)</span>
                                    )}
                                </div>

                                {/* Role Selector + Remove */}
                                <div className="ml-auto flex-shrink-0 flex items-center gap-2">
                                    {isAdmin ? (
                                        <span className="text-xs text-dim px-3 py-1.5">
                                            Protected
                                        </span>
                                    ) : (
                                        <>
                                            <select
                                                value={u.role}
                                                disabled={isDisabled}
                                                onChange={(e) =>
                                                    handleRoleChange(
                                                        u.id,
                                                        u.username,
                                                        e.target.value as Exclude<UserRole, 'admin'>,
                                                    )
                                                }
                                                className="text-sm bg-surface border border-edge rounded-lg px-3 py-1.5 text-foreground disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                                            >
                                                <option value="member">Member</option>
                                                <option value="operator">Operator</option>
                                            </select>
                                            {!isCurrentUser && (
                                                <button
                                                    onClick={() =>
                                                        setRemoveTarget({
                                                            id: u.id,
                                                            username: u.username,
                                                        })
                                                    }
                                                    disabled={removeUser.isPending}
                                                    className="p-1.5 text-dim hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                                                    title="Remove user"
                                                >
                                                    <svg
                                                        className="w-4 h-4"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                        />
                                                    </svg>
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-sm text-muted text-center py-6">
                    {debouncedSearch ? 'No users match your search' : 'No users found'}
                </p>
            )}

            {/* Infinite Scroll Sentinel */}
            {items.length > 0 && (
                <div className="mt-4 pt-3 border-t border-edge/30">
                    <span className="text-xs text-dim">{total} users</span>
                    <InfiniteScrollSentinel
                        sentinelRef={sentinelRef}
                        isFetchingNextPage={isFetchingNextPage}
                        hasNextPage={hasNextPage}
                    />
                </div>
            )}

            {/* Remove User Confirmation Modal */}
            <Modal
                isOpen={!!removeTarget}
                onClose={() => setRemoveTarget(null)}
                title="Remove User"
            >
                <div className="space-y-4">
                    <p className="text-secondary">
                        Remove{' '}
                        <strong className="text-foreground">
                            {removeTarget?.username}
                        </strong>
                        ? This permanently deletes their account and all
                        associated data.
                    </p>

                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-sm text-red-400">
                            This action cannot be undone. Their characters,
                            signups, and preferences will be permanently deleted.
                            Events they created will be reassigned to you.
                        </p>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={() => setRemoveTarget(null)}
                            className="px-4 py-2 text-sm bg-overlay hover:bg-faint text-foreground rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleRemoveConfirm}
                            disabled={removeUser.isPending}
                            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                        >
                            {removeUser.isPending ? 'Removing...' : 'Remove'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
