/**
 * ROK-1571 — the LFG hero's "Participants · N" chip (avatars + count).
 *
 * `LineupParticipantsButton` reads its roster from a lineup query, and an LFG
 * group has no lineup, so this ports its `touch` recipe (44px below `lg`, the
 * 36px desktop chip from `lg`) around the shared `MemberAvatarGroup`.
 */
import type { JSX } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { MemberAvatarGroup } from '../../components/lineups/decided/MemberAvatarGroup';
import { LFG_PARTICIPANTS_CHIP_CLS, participantsLabel } from './lfg-dialog-recipes';

type AvatarMember = Parameters<typeof MemberAvatarGroup>[0]['members'][number];

/** Same avatar routing as `LfgGroupSummary` (absolute URL → Discord slot). */
function toAvatarMember(member: LfgMemberDto): AvatarMember {
    const absolute = member.avatarUrl?.startsWith('http') === true;
    return {
        userId: member.userId,
        displayName: member.displayName ?? member.username,
        avatar: absolute ? member.avatarUrl : null,
        discordId: null,
        customAvatarUrl: absolute ? null : member.avatarUrl,
    };
}

export interface LfgParticipantsChipProps {
    members: LfgMemberDto[];
    onOpen: () => void;
}

export function LfgParticipantsChip({ members, onOpen }: LfgParticipantsChipProps): JSX.Element {
    const count = members.length;
    const label = participantsLabel(count);
    return (
        <button type="button" data-testid="lfg-participants-chip" aria-label={label} onClick={onOpen} className={LFG_PARTICIPANTS_CHIP_CLS}>
            <span className="whitespace-nowrap">{label}</span>
            {count > 0 && <MemberAvatarGroup members={members.map(toAvatarMember)} max={4} />}
        </button>
    );
}
