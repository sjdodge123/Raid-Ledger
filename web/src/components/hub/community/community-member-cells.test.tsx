/**
 * ROK-1893 P1 — the join-source chip beside "Joined <date>" on community
 * member rows: Invite / Auto / Prompt; nothing for a manual join or a row
 * that predates ROK-1893.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HubJoinSource } from '@raid-ledger/contract';
import { buildCommunityMember } from '../../../test/factories/community-hub';
import type { HubMemberRow } from '../../../plugins/hub-module';
import { CommunityJoinedCell } from './community-member-cells';

function rowWith(joinSource: HubJoinSource | null | undefined): HubMemberRow {
    const row = buildCommunityMember(3, 'Mem', 'member');
    const community = row.community;
    if (community === undefined) throw new Error('factory row has no community block');
    return { ...row, community: { ...community, ...(joinSource === undefined ? {} : { joinSource }) } };
}

describe('CommunityJoinedCell join-source chip', () => {
    it.each([
        ['invite', 'Invite', 'Joined through an invite link'],
        ['auto', 'Auto', 'Joined automatically by signing up for a hub event'],
        ['prompt', 'Prompt', 'Joined from the “Join this hub?” prompt'],
    ] as const)('labels a %s join as a neutral "%s" chip', (source, label, title) => {
        render(<CommunityJoinedCell row={rowWith(source)} />);
        const chip = screen.getByTestId('community-member-join-source');
        expect(chip).toHaveTextContent(label);
        expect(chip.parentElement).toHaveAttribute('data-tone', 'neutral');
        expect(chip.parentElement).toHaveAttribute('title', title);
        expect(screen.getByTestId('community-member-joined')).toHaveTextContent(/^Joined /);
    });

    it.each([['manual'], [null], [undefined]] as const)('shows no chip for %s', (source) => {
        render(<CommunityJoinedCell row={rowWith(source)} />);
        expect(screen.queryByTestId('community-member-join-source')).not.toBeInTheDocument();
        expect(screen.getByTestId('community-member-joined')).toBeInTheDocument();
    });
});
