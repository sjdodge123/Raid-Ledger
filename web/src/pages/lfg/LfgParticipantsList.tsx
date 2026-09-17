/**
 * ROK-1571 (approved H5) — the participants list the chip opens: who is
 * looking and how soon each wants to play. Sheet below 768px, modal from 768px.
 */
import type { JSX } from 'react';
import type { LfgMemberDto } from '@raid-ledger/contract';
import { useNowTick } from '../../hooks/use-now-tick';
import { LFG_COPY, expiresIn } from './lfg-copy';
import { participantsLabel } from './lfg-dialog-recipes';
import { LfgMemberRow, LfgSheetOrModal } from './LfgSheetOrModal';

export interface LfgParticipantsListProps {
    isOpen: boolean;
    members: LfgMemberDto[];
    onClose: () => void;
}

/** Urgency chip — amber for right now (the now-strip family), neutral for the week. */
function UrgencyChip({ member, now }: { member: LfgMemberDto; now: number }): JSX.Element {
    if (member.urgency === 'now') {
        const left = expiresIn(Date.parse(member.expiresAt) - now);
        return (
            <span data-testid="lfg-participant-urgency" className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
                {`${LFG_COPY.nowStripTitle} · ${left}`}
            </span>
        );
    }
    return (
        <span data-testid="lfg-participant-urgency" className="inline-flex items-center rounded-full border border-edge bg-overlay/40 px-2 py-0.5 text-[10px] text-muted">
            {LFG_COPY.urgencyWeek}
        </span>
    );
}

export function LfgParticipantsList({ isOpen, members, onClose }: LfgParticipantsListProps): JSX.Element | null {
    // The same shared countdown `LfgNowStrip` runs on.
    const now = useNowTick(members.filter((m) => m.urgency === 'now').map((m) => m.expiresAt));
    return (
        <LfgSheetOrModal isOpen={isOpen} onClose={onClose} title={participantsLabel(members.length)}>
            <ul data-testid="lfg-participants-list" className="space-y-2">
                {members.map((m) => (
                    <LfgMemberRow key={m.userId} member={m} trailing={<UrgencyChip member={m} now={now} />} />
                ))}
            </ul>
        </LfgSheetOrModal>
    );
}
