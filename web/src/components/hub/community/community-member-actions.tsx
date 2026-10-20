/**
 * ROK-1870 §3.1 — the per-row "Manage" menu on the community Members tab,
 * gated by the §2.5 matrix (`communityRowActions`). Rows the viewer may not
 * act on render nothing. Every command targets `row.community.userId` (the
 * member's user id), never `row.memberId` (the membership row id). The shell
 * is the §4.14 split: dropdown from 1024px, bottom sheet below.
 */
import { useState, type JSX } from 'react';
import type { HubCtx, HubMemberRow } from '../../../plugins/hub-module';
import { useAuth } from '../../../hooks/use-auth';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { communityRowActions, type CommunityRowAction } from './community-access';
import { useCommunityMemberCommand, type CommunityMemberCommand } from './community-hub-api';
import { CommunityBanDialog } from './community-ban-dialog';
import { MemberManageDropdown, MemberManageSheet } from './community-member-menu';

function commandFor(action: Exclude<CommunityRowAction, 'ban'>, userId: number): CommunityMemberCommand {
    if (action === 'remove') return { kind: 'remove', userId };
    if (action === 'make-leader') return { kind: 'leader', userId };
    return { kind: 'role', userId, role: action === 'make-officer' ? 'officer' : 'member' };
}

/** The Manage trigger + menu for one member row, and its Ban dialog. */
export function CommunityMemberActions({ row, ctx }: { row: HubMemberRow; ctx: HubCtx }): JSX.Element | null {
    const { user } = useAuth();
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const cmd = useCommunityMemberCommand(ctx.page.guild.id);
    const [banning, setBanning] = useState(false);
    const target = row.community?.userId;
    const actions = communityRowActions(ctx.page.viewer.role, row, user?.id ?? null);
    if (actions.length === 0 || target === undefined) return null;
    const pick = (a: CommunityRowAction): void => {
        if (a === 'ban') setBanning(true);
        else cmd.mutate(commandFor(a, target));
    };
    const Shell = isDesktop ? MemberManageDropdown : MemberManageSheet;
    return (
        <>
            <Shell name={row.name} actions={actions} disabled={cmd.isPending} onPick={pick} />
            {banning && <CommunityBanDialog name={row.name} onClose={() => setBanning(false)}
                onConfirm={(reason) => { setBanning(false); cmd.mutate({ kind: 'ban', userId: target, ...(reason ? { reason } : {}) }); }} />}
        </>
    );
}
