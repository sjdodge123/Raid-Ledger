/**
 * ROK-1870 §3.1 — the per-row "Manage" menu on the community Members tab,
 * gated by the §2.5 matrix (`communityRowActions`). Rows the viewer may not
 * act on render nothing.
 */
import { useState, type JSX } from 'react';
import type { HubCtx, HubMemberRow } from '../../../plugins/hub-module';
import { useAuth } from '../../../hooks/use-auth';
import { Button } from '../../ui/button';
import { communityRowActions, type CommunityRowAction } from './community-access';
import { useCommunityMemberCommand, type CommunityMemberCommand } from './community-hub-api';
import { CommunityBanDialog } from './community-ban-dialog';

const LABEL: Record<CommunityRowAction, string> = {
    remove: 'Remove', ban: 'Ban…', 'make-officer': 'Make officer', 'make-member': 'Make member', 'make-leader': 'Make leader',
};

function commandFor(action: Exclude<CommunityRowAction, 'ban'>, userId: number): CommunityMemberCommand {
    if (action === 'remove') return { kind: 'remove', userId };
    if (action === 'make-leader') return { kind: 'leader', userId };
    return { kind: 'role', userId, role: action === 'make-officer' ? 'officer' : 'member' };
}

export function CommunityMemberActions({ row, ctx }: { row: HubMemberRow; ctx: HubCtx }): JSX.Element | null {
    const { user } = useAuth();
    const cmd = useCommunityMemberCommand(ctx.page.guild.id);
    const [open, setOpen] = useState(false);
    const [banning, setBanning] = useState(false);
    const actions = communityRowActions(ctx.page.viewer.role, row, user?.id ?? null);
    if (actions.length === 0) return null;
    const pick = (a: CommunityRowAction): void => {
        setOpen(false);
        if (a === 'ban') setBanning(true);
        else cmd.mutate(commandFor(a, row.memberId));
    };
    return (
        <span className="relative inline-flex">
            <Button variant="ghost" size="sm" aria-haspopup="true" aria-expanded={open} disabled={cmd.isPending}
                aria-label={`Manage ${row.name}`} data-testid="community-member-manage" onClick={() => setOpen((o) => !o)}>Manage</Button>
            {open && (
                <span role="menu" aria-label={`Manage ${row.name}`}
                    className="absolute right-0 top-full z-50 mt-1 flex w-44 flex-col overflow-hidden rounded-lg border border-edge bg-surface py-1 shadow-xl">
                    {actions.map((a) => (
                        <Button key={a} variant="ghost" size="sm" role="menuitem" data-testid={`community-member-${a}`} onClick={() => pick(a)}
                            className={`justify-start rounded-none ${a === 'remove' || a === 'ban' ? 'text-danger' : 'text-secondary'}`}>{LABEL[a]}</Button>
                    ))}
                </span>
            )}
            {banning && <CommunityBanDialog name={row.name} onClose={() => setBanning(false)}
                onConfirm={(reason) => { setBanning(false); cmd.mutate({ kind: 'ban', userId: row.memberId, ...(reason ? { reason } : {}) }); }} />}
        </span>
    );
}
