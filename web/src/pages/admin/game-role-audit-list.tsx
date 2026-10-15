/**
 * ROK-1767 (L3): a linked game's last 20 role changes (who, added/removed,
 * why, when), shown when its row in the Game roles section is expanded.
 */
import type { JSX } from 'react';
import { useGameRoleAudit } from '../../hooks/admin/use-game-roles';

const fmt = (iso: string) => new Date(iso).toLocaleString();

/** Audit trail for one linked game. */
export function GameRoleAuditList({ gameId }: { gameId: number }): JSX.Element {
    const audit = useGameRoleAudit(gameId, true);
    if (audit.isError) {
        return <p role="alert" className="text-sm text-danger">Couldn&apos;t load the role history.</p>;
    }
    if (!audit.data) return <p className="text-sm text-muted">Loading role history…</p>;
    if (audit.data.length === 0) {
        return <p className="text-sm text-muted">No role changes yet. They appear after the next sync.</p>;
    }
    return (
        <ul className="space-y-1" data-testid={`game-role-audit-${gameId}`}>
            {audit.data.map((e) => (
                <li key={`${e.userId}-${e.at}-${e.action}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className={e.action === 'role_added' ? 'text-success' : 'text-warning'}>
                        {e.action === 'role_added' ? 'Added' : 'Removed'}
                    </span>
                    <span className="text-foreground font-medium">{e.username}</span>
                    <span className="text-secondary">{e.reason}</span>
                    <span className="text-xs text-muted ml-auto">{fmt(e.at)}</span>
                </li>
            ))}
        </ul>
    );
}
