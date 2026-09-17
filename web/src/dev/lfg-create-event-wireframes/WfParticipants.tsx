/**
 * ROK-1571 — the LFG hero's Participants chip and the list it opens.
 *
 * Dev copy of `LineupParticipantsButton` (size="touch"): the shipped chip reads
 * its roster from `useLineupParticipants(lineupId)`, and an LFG group has no
 * lineup. Same recipe — 44px target below `lg`, compact pill from `lg` — and
 * the REAL `MemberAvatarGroup`. The list swaps the lineup's role/voted chips for
 * what an LFG group has instead: how soon each member wants to play.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto, LfgMemberDto } from '@raid-ledger/contract';
import { useNowTick } from '../../hooks/use-now-tick';
import { MemberAvatarGroup } from '../../components/lineups/decided/MemberAvatarGroup';
import { LFG_COPY, expiresIn } from '../../pages/lfg/lfg-copy';
import { WfMemberRow, WfSheetOrModal } from './WfSheetOrModal';

/** `LineupParticipantsButton`'s TOUCH_CLS, verbatim (file-private there). */
const CHIP_CLS =
    'inline-flex items-center gap-2 rounded-full border transition-colors ' +
    'min-h-[44px] px-3 py-2 text-sm border-edge-strong bg-surface text-foreground ' +
    'lg:min-h-0 lg:px-2 lg:py-0.5 lg:text-[10px] lg:border-edge lg:bg-transparent ' +
    'lg:text-muted hover:text-foreground lg:hover:border-edge/80';

/** Same avatar routing as `LfgGroupSummary` (absolute URL → Discord slot). */
function toAvatarMember(member: LfgMemberDto): Parameters<typeof MemberAvatarGroup>[0]['members'][number] {
    const absolute = member.avatarUrl?.startsWith('http') === true;
    return {
        userId: member.userId,
        displayName: member.displayName ?? member.username,
        avatar: absolute ? member.avatarUrl : null,
        discordId: null,
        customAvatarUrl: absolute ? null : member.avatarUrl,
    };
}

/** "Participants · N" + avatar stack. */
export function WfParticipantsChip({ group, onOpen }: { group: LfgGroupDetailDto; onOpen: () => void }): JSX.Element {
    const count = group.members.length;
    return (
        <button type="button" data-testid="wf-participants-chip" aria-label={`Participants, ${count}`} onClick={onOpen} className={CHIP_CLS}>
            <span className="whitespace-nowrap">{`Participants · ${count}`}</span>
            {count > 0 && <MemberAvatarGroup members={group.members.map(toAvatarMember)} max={4} />}
        </button>
    );
}

/** Urgency chip — amber for right now (the now-strip family), neutral for the week. */
function UrgencyChip({ member, now }: { member: LfgMemberDto; now: number }): JSX.Element {
    if (member.urgency === 'now') {
        const left = expiresIn(Date.parse(member.expiresAt) - now);
        return (
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
                {`${LFG_COPY.nowStripTitle} · ${left}`}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center rounded-full border border-edge bg-overlay/40 px-2 py-0.5 text-[10px] text-muted">
            {LFG_COPY.urgencyWeek}
        </span>
    );
}

/** The participants list (H5). */
export function WfParticipantsList({ group, isOpen, onClose }: {
    group: LfgGroupDetailDto; isOpen: boolean; onClose: () => void;
}): JSX.Element | null {
    // The same shared countdown `LfgNowStrip` runs on.
    const now = useNowTick(group.members.filter((m) => m.urgency === 'now').map((m) => m.expiresAt));
    return (
        <WfSheetOrModal isOpen={isOpen} onClose={onClose} title={`Participants · ${group.members.length}`}>
            <ul data-testid="wf-participants-list" className="space-y-2">
                {group.members.map((m) => (
                    <WfMemberRow key={m.userId} member={m} trailing={<UrgencyChip member={m} now={now} />} />
                ))}
            </ul>
        </WfSheetOrModal>
    );
}
