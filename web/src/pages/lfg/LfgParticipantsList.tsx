/**
 * ROK-1571 (approved H5) — the participants list the chip opens: who is
 * looking and how soon each wants to play. Sheet below 768px, modal from 768px.
 */
import type { ComponentType, JSX } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { useNowTick } from '../../hooks/use-now-tick';
import { LFG_COPY, expiresIn } from './lfg-copy';
import { participantsLabel } from './lfg-dialog-recipes';
import { LfgMemberRow, LfgSheetOrModal } from './LfgSheetOrModal';
import type { LfgGroupingContext, LfgMemberBadgesProps } from '../../plugins/lfg-grouping';

/** ROK-2352: the active grouping's `MemberBadges` and the page context. */
export interface LfgMemberBadgesSlot {
    Badges: ComponentType<LfgMemberBadgesProps>;
    context: LfgGroupingContext;
}

export interface LfgParticipantsListProps {
    isOpen: boolean;
    members: LfgMemberDto[];
    onClose: () => void;
    badges?: LfgMemberBadgesSlot | undefined;
}

/** Urgency chip — amber for right now (the now-strip family), neutral for tonight and the week. */
function UrgencyChip({ member, now }: { member: LfgMemberDto; now: number }): JSX.Element {
    if (member.urgency === 'now') {
        const left = expiresIn(Date.parse(member.expiresAt) - now);
        return (
            <span data-testid="lfg-participant-urgency" className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
                {`${LFG_COPY.nowStripTitle} · ${left}`}
            </span>
        );
    }
    return (
        <span data-testid="lfg-participant-urgency" className="inline-flex items-center rounded-full border border-edge bg-overlay/40 px-2 py-0.5 text-[10px] text-muted">
            {member.urgency === 'tonight' ? LFG_COPY.urgencyTonight : LFG_COPY.urgencyWeek}
        </span>
    );
}

export function LfgParticipantsList({ isOpen, members, onClose, badges }: LfgParticipantsListProps): JSX.Element | null {
    // The same shared countdown `LfgNowStrip` runs on.
    const now = useNowTick(members.filter((m) => m.urgency === 'now').map((m) => m.expiresAt));
    return (
        <LfgSheetOrModal isOpen={isOpen} onClose={onClose} title={participantsLabel(members.length)}>
            <ul data-testid="lfg-participants-list" className="space-y-2">
                {members.map((m) => (
                    <LfgMemberRow key={m.userId} member={m} trailing={(
                        <span className="flex min-w-0 items-center gap-2">
                            {badges ? <badges.Badges context={badges.context} member={m} /> : null}
                            <UrgencyChip member={m} now={now} />
                        </span>
                    )} />
                ))}
            </ul>
        </LfgSheetOrModal>
    );
}
