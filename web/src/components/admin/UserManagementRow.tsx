import { useEffect, useRef, useState, type JSX } from 'react';
import { RoleBadge } from '../ui/role-badge';
import { Button } from '../ui/button';
import { Select } from '../ui/select';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import type { UserRole, UserManagementDto } from '@raid-ledger/contract';
import type { ModerationTarget } from './moderation-shared';

// --- Hand-rolled inline icons (matches the existing admin-icon style) ---

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

const KickIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
);

const BanIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.929 4.929l14.142 14.142M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const UnkickIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14M7 8V7a3 3 0 013-3h4a3 3 0 013 3v10a3 3 0 01-3 3h-4a3 3 0 01-3-3v-1" />
    </svg>
);

const UnbanIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

// --- Presentational bits ---

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

function StatusBadge({ label, tone }: { label: string; tone: string }) {
    return (
        <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${tone}`}>
            {label}
        </span>
    );
}

const DEACTIVATED_TONE = 'bg-warning/15 text-warning border-warning/30';
const BANNED_TONE = 'bg-danger/15 text-danger border-danger/30';

/** Precedence: banned (red) > kicked (amber) > deactivated (amber). */
function UserStatusBadge({ user }: { user: UserManagementDto }) {
    if (user.bannedAt) return <StatusBadge label="Banned" tone={BANNED_TONE} />;
    if (user.kickedAt) return <StatusBadge label="Kicked" tone={DEACTIVATED_TONE} />;
    if (user.deactivatedAt) return <StatusBadge label="Deactivated" tone={DEACTIVATED_TONE} />;
    return null;
}

// --- Kebab action menu ---

interface RowState { isKicked: boolean; isBanned: boolean; isDeactivated: boolean; }
export interface RowHandlers {
    onRemove: (t: ModerationTarget) => void;
    onReactivate: (t: ModerationTarget) => void;
    onKick: (t: ModerationTarget) => void;
    onBan: (t: ModerationTarget) => void;
    onUnkick: (t: ModerationTarget) => void;
    onUnban: (t: ModerationTarget) => void;
}
/** `destructive` items render `destructive-soft`; the rest `ghost` (ruling 10 — no per-item hue). */
interface MenuItemSpec { key: string; icon: JSX.Element; label: string; destructive?: boolean; onClick: () => void; }

/** Build the ordered menu items for a row's current moderation state. */
function buildMenuItems(s: RowState, bound: Record<keyof RowHandlers, () => void>): MenuItemSpec[] {
    const remove: MenuItemSpec = { key: 'remove', icon: TrashIcon, label: 'Remove user', destructive: true, onClick: bound.onRemove };
    if (s.isBanned) {
        return [{ key: 'unban', icon: UnbanIcon, label: 'Unban user', onClick: bound.onUnban }, remove];
    }
    if (s.isKicked) {
        return [
            { key: 'unkick', icon: UnkickIcon, label: 'Unkick user', onClick: bound.onUnkick },
            { key: 'ban', icon: BanIcon, label: 'Ban user', destructive: true, onClick: bound.onBan },
            remove,
        ];
    }
    if (s.isDeactivated) {
        // A guild-left (deactivated) user can still be banned — the backend
        // hardens banUser with deactivated_at=COALESCE(...) to close the
        // ROK-1353 re-mint hole if they rejoin (spec §9.5). Ban is admin-UI-only,
        // so the deactivated branch must offer it alongside Reactivate.
        return [
            { key: 'reactivate', icon: ReactivateIcon, label: 'Reactivate user', onClick: bound.onReactivate },
            { key: 'ban', icon: BanIcon, label: 'Ban user', destructive: true, onClick: bound.onBan },
        ];
    }
    return [
        { key: 'kick', icon: KickIcon, label: 'Kick user', destructive: true, onClick: bound.onKick },
        { key: 'ban', icon: BanIcon, label: 'Ban user', destructive: true, onClick: bound.onBan },
        remove,
    ];
}

/**
 * Button centres its label (`justify-center`, no tailwind-merge), so a menu row
 * stretches the label span to the full width instead: its own `inline-flex`
 * then packs icon + text from the left.
 */
const MENU_ITEM_LEFT = '[&>[data-button-label]]:w-full';

/** The open menu: ghost rows, destructive-soft for Kick / Ban / Remove (ruling 10). */
function ActionMenuList({ items }: { items: MenuItemSpec[] }) {
    return (
        <div role="menu" className="absolute right-0 top-full mt-1 z-10 min-w-[12rem] bg-panel border border-edge rounded-lg shadow-lg p-1 flex flex-col gap-1">
            {items.map((it) => (
                <Button key={it.key} role="menuitem" variant={it.destructive ? 'destructive-soft' : 'ghost'} size="sm" fullWidth
                    className={MENU_ITEM_LEFT} onClick={it.onClick}>
                    {it.icon}{it.label}
                </Button>
            ))}
        </div>
    );
}

function useMenuDismiss(open: boolean, close: () => void) {
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [open, close]);
    return rootRef;
}

function UserActionMenu({ target, state, handlers, isCurrentUser, isPending }: {
    target: ModerationTarget; state: RowState; handlers: RowHandlers; isCurrentUser: boolean; isPending: boolean;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useMenuDismiss(open, () => setOpen(false));

    if (isCurrentUser && !state.isDeactivated && !state.isBanned && !state.isKicked) return null;

    const run = (fn: (t: ModerationTarget) => void) => () => { setOpen(false); fn(target); };
    const bound = {
        onRemove: run(handlers.onRemove), onReactivate: run(handlers.onReactivate),
        onKick: run(handlers.onKick), onBan: run(handlers.onBan),
        onUnkick: run(handlers.onUnkick), onUnban: run(handlers.onUnban),
    };
    const items = buildMenuItems(state, bound);

    return (
        <div ref={rootRef} className="relative">
            <Button variant="ghost" size="sm" iconOnly aria-label={`Actions for ${target.username}`}
                aria-haspopup="menu" aria-expanded={open} disabled={isPending} onClick={() => setOpen((v) => !v)}>
                {MoreVerticalIcon}
            </Button>
            {open && <ActionMenuList items={items} />}
        </div>
    );
}

// --- Row ---

export interface UserRowProps {
    user: UserManagementDto;
    currentUserId: number | undefined;
    onRoleChange: (id: number, name: string, role: Exclude<UserRole, 'admin'>) => void;
    handlers: RowHandlers;
    isUpdating: boolean;
    isBusy: boolean;
}

function RowActions({ user, target, state, isCurrentUser, isAdmin, isDisabled, onRoleChange, handlers, isBusy }: {
    user: UserManagementDto; target: ModerationTarget; state: RowState; isCurrentUser: boolean; isAdmin: boolean;
    isDisabled: boolean; onRoleChange: UserRowProps['onRoleChange']; handlers: RowHandlers; isBusy: boolean;
}) {
    if (isAdmin) return <span className="text-xs text-dim px-3 py-1.5">Protected</span>;
    return (
        <>
            <Select fieldSize="sm" wrapperClassName="w-auto" aria-label={`Role for ${user.username}`} value={user.role} disabled={isDisabled}
                onChange={(e) => onRoleChange(user.id, user.username, e.target.value as Exclude<UserRole, 'admin'>)}>
                <option value="member">Member</option>
                <option value="operator">Operator</option>
            </Select>
            <UserActionMenu target={target} state={state} handlers={handlers} isCurrentUser={isCurrentUser} isPending={isBusy} />
        </>
    );
}

export function UserRow({ user, currentUserId, onRoleChange, handlers, isUpdating, isBusy }: UserRowProps) {
    const isCurrentUser = user.id === currentUserId;
    const isAdmin = user.role === 'admin';
    const state: RowState = { isKicked: user.kickedAt != null, isBanned: user.bannedAt != null, isDeactivated: user.deactivatedAt != null };
    const target: ModerationTarget = { id: user.id, username: user.username, discordId: user.discordId };
    const av = resolveAvatar(toAvatarUser(user));

    return (
        <div className="flex items-center gap-3 py-2.5">
            <UserAvatar username={user.username} avatarUrl={av.url} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                <span className="text-sm text-foreground truncate">{user.username}</span>
                <RoleBadge role={user.role} />
                <UserStatusBadge user={user} />
                {isCurrentUser && <span className="text-xs text-dim">(you)</span>}
            </div>
            <div className="ml-auto flex-shrink-0 flex items-center gap-2">
                <RowActions user={user} target={target} state={state} isCurrentUser={isCurrentUser} isAdmin={isAdmin}
                    isDisabled={isCurrentUser || isAdmin || isUpdating} onRoleChange={onRoleChange} handlers={handlers} isBusy={isBusy} />
            </div>
        </div>
    );
}
