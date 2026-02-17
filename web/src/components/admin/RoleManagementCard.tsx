import { useState } from 'react';
import { useUserManagement } from '../../hooks/use-user-management';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useAuth } from '../../hooks/use-auth';
import { RoleBadge } from '../ui/role-badge';
import { InfiniteScrollSentinel } from '../ui/infinite-scroll-sentinel';
import { toast } from '../../lib/toast';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { UserRole } from '@raid-ledger/contract';

/**
 * Role Management Card for admin settings (ROK-272 AC-2).
 * Shows a searchable table of users with role dropdowns.
 * Admin can promote/demote between member and operator.
 */
export function RoleManagementCard() {
    const { user: currentUser } = useAuth();
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 300);

    const { users, updateRole } = useUserManagement({
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

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Role Management</h3>
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

                                {/* Role Selector */}
                                <div className="ml-auto flex-shrink-0">
                                    {isAdmin ? (
                                        <span className="text-xs text-dim px-3 py-1.5">
                                            Protected
                                        </span>
                                    ) : (
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
        </div>
    );
}
