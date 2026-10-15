/**
 * ROK-1767 (L3): admin card for auto-maintained per-game Discord roles. Lists
 * linked games (role, window, members granted, last sync, enabled Switch);
 * a row expands into its audit trail. "Link game" opens the link dialog and
 * "Run now" syncs every enabled game immediately.
 */
import { useState, type JSX } from 'react';
import type { GameRoleSummaryDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { Switch } from '../../components/ui/switch';
import { toast } from '../../lib/toast';
import { useGameRoles } from '../../hooks/admin/use-game-roles';
import { GameRoleAuditList } from './game-role-audit-list';
import { GameRoleLinkDialog } from './game-role-link-dialog';

type Roles = ReturnType<typeof useGameRoles>;

const lastRun = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Not run yet');

function useRunNow(run: Roles['run']) {
    return () => run.mutate(undefined, {
        onSuccess: (r) => {
            const summary = `Game roles synced: ${r.added} added, ${r.removed} removed`;
            if (r.failedGames.length > 0 || r.skippedOverCap > 0) {
                toast.error(`${summary}; ${r.failedGames.length} game(s) failed, ${r.skippedOverCap} change(s) deferred`);
            } else toast.success(summary);
        },
        onError: (err) => toast.error(err.message),
    });
}

function Header({ onLink, onRun, running }: { onLink: () => void; onRun: () => void; running: boolean }): JSX.Element {
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h3 className="text-base font-semibold text-foreground">Game roles</h3>
                <p className="text-sm text-muted mt-1">
                    Give members a game&apos;s Discord role while they play it, and take it back after they go idle.
                    Roles you assign by hand are never removed.
                </p>
            </div>
            <div className="flex gap-2 shrink-0">
                <Button variant="secondary" onClick={onRun} disabled={running}>{running ? 'Running…' : 'Run now'}</Button>
                <Button variant="primary" onClick={onLink}>Link game</Button>
            </div>
        </div>
    );
}

function UnlinkConfirm({ row, roles, onClose }: { row: GameRoleSummaryDto; roles: Roles; onClose: () => void }): JSX.Element {
    const pending = roles.remove.isPending;
    const unlink = () => roles.remove.mutate(row.gameId, {
        onSuccess: () => { toast.success(`${row.gameName} unlinked`); onClose(); },
        onError: (err) => toast.error(err.message),
    });
    const footer = (
        <>
            <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button variant="destructive" onClick={unlink} disabled={pending}>{pending ? 'Unlinking…' : 'Unlink'}</Button>
        </>
    );
    return (
        <Modal isOpen onClose={pending ? () => undefined : onClose} title={`Unlink ${row.gameName}?`} footer={footer}>
            <p className="text-sm text-secondary">
                The bot stops managing this role. Members keep the role they have now, and this game&apos;s audit history is cleared.
            </p>
        </Modal>
    );
}

function RowDetail({ row, roles }: { row: GameRoleSummaryDto; roles: Roles }): JSX.Element {
    const [confirming, setConfirming] = useState(false);
    return (
        <div className="mt-3 space-y-3 bg-overlay/30 border border-edge rounded-lg p-3">
            <GameRoleAuditList gameId={row.gameId} />
            <Button variant="destructive-soft" size="sm" onClick={() => setConfirming(true)}>Unlink</Button>
            {confirming && <UnlinkConfirm row={row} roles={roles} onClose={() => setConfirming(false)} />}
        </div>
    );
}

function GameRoleRow({ row, roles }: { row: GameRoleSummaryDto; roles: Roles }): JSX.Element {
    const [open, setOpen] = useState(false);
    const toggle = (enabled: boolean) => roles.upsert.mutate(
        { gameId: row.gameId, body: { roleId: row.roleId, windowDays: row.windowDays, enabled } },
        { onError: (err) => toast.error(err.message) },
    );
    const role = row.roleName ? `@${row.roleName}` : 'Role missing in Discord';
    return (
        <li className="py-3" data-testid={`game-role-row-${row.gameId}`}>
            <div className="flex items-center justify-between gap-4">
                <Button variant="bare" aria-expanded={open} onClick={() => setOpen((v) => !v)}
                    className="block text-left min-w-0 flex-1 min-h-[44px]">
                    <span className="block text-sm font-semibold text-foreground truncate">{row.gameName}</span>
                    <span className={`block text-sm ${row.roleName ? 'text-secondary' : 'text-warning'}`}>{role}</span>
                    <span className="block text-xs text-muted">
                        {row.windowDays}-day window · {row.grantedCount} granted · Last run: {lastRun(row.lastReconciledAt)}
                    </span>
                </Button>
                <Switch label={`Manage the ${row.gameName} role`} checked={row.enabled}
                    disabled={roles.upsert.isPending} onChange={toggle} />
            </div>
            {open && <RowDetail row={row} roles={roles} />}
        </li>
    );
}

function RowList({ roles }: { roles: Roles }): JSX.Element {
    if (roles.list.isError) {
        return <p role="alert" className="text-sm text-danger">Couldn&apos;t load the game roles. Reload the page to try again.</p>;
    }
    const rows = roles.list.data ?? [];
    if (rows.length === 0) {
        return <p className="text-sm text-muted text-center py-6">No games linked yet. Link a game to start managing its role.</p>;
    }
    return <ul className="divide-y divide-edge">{rows.map((r) => <GameRoleRow key={r.gameId} row={r} roles={roles} />)}</ul>;
}

/** Game roles card on the Discord Features page. */
export function GameRolesSection(): JSX.Element {
    const roles = useGameRoles();
    const runNow = useRunNow(roles.run);
    const [dialogKey, setDialogKey] = useState<number | null>(null);
    return (
        <div className="bg-surface rounded-xl border border-edge p-6" data-testid="game-roles-section">
            <Header onLink={() => setDialogKey(Date.now())} onRun={runNow} running={roles.run.isPending} />
            <div className="mt-4"><RowList roles={roles} /></div>
            {dialogKey !== null && (
                <GameRoleLinkDialog key={dialogKey} isOpen onClose={() => setDialogKey(null)} />
            )}
        </div>
    );
}
