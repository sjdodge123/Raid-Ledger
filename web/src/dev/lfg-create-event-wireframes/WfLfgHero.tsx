/**
 * ROK-1573/1572/1571 — the LFG page's ONE top-of-page card, drawn with the
 * REAL shared `JourneyHero` (H1-b) wired the way `SchedulingToolbar` wires it:
 *
 *   badge line   → LOOKING FOR MEMBERS / FULL GROUP / EVENT SET
 *   headline row → "4 looking · 2 want to play now" + Participants chip (`action`)
 *   header block → the single primary + its sub-line (`headerAction`, `headerActionBlock`)
 *   manage slot  → "Manage ⋯" (`manage`) — full-width 44px row on phones
 *
 * No phase ribbon (`noRibbon`): an LFG group has no lineup phases.
 * This replaces the status bar AND the separate full-group banner.
 */
import type { JSX } from 'react';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../components/shared/journey-hero';
import { SCHEDULING_MANAGE_BUTTON } from '../../components/lineups/cycle-4/scheduling-action-button';
import { WfParticipantsChip } from './WfParticipants';
import { HERO_PRIMARY_BTN, WF_COPY } from './wireframe-variants';

export interface WfLfgHeroProps {
    group: LfgGroupDetailDto;
    /** Set once the group was locked into an event (H6). */
    event: { label: string; signupCount: number } | null;
    onPrimary: () => void;
    onManage: () => void;
    onParticipants: () => void;
}

/** `4 looking · 2 want to play now` (the now half drops at zero). */
function groupHeadline(group: LfgGroupDetailDto): string {
    const now = group.nowCount > 0 ? ` · ${group.nowCount} want to play now` : '';
    return `${group.activeCount} looking${now}`;
}

/** `Needs 1 more for a full group` — only while short of the threshold. */
function groupSub(group: LfgGroupDetailDto): string | undefined {
    if (group.viabilityThreshold == null) return undefined;
    const missing = group.viabilityThreshold - group.activeCount;
    return missing > 0 ? `Needs ${missing} more for a full group` : undefined;
}

/** The single primary and the line under it. */
function HeroPrimary({ label, note, onClick }: { label: string; note?: string; onClick: () => void }): JSX.Element {
    return (
        <div className="flex w-full flex-col items-stretch gap-1 lg:w-auto lg:items-end">
            <button type="button" data-testid="wf-hero-primary" className={HERO_PRIMARY_BTN} onClick={onClick}>
                {label}
            </button>
            {note && <p className="text-xs text-muted">{note}</p>}
        </div>
    );
}

/** "Manage ⋯" — the scheduling manage row; compact and right-aligned from `lg`. */
function ManageButton({ onClick }: { onClick: () => void }): JSX.Element {
    return (
        <button
            type="button"
            data-testid="wf-manage"
            aria-haspopup="dialog"
            onClick={onClick}
            className={`${SCHEDULING_MANAGE_BUTTON} lg:ml-auto lg:w-auto lg:min-h-[36px]`}
        >
            <span>{WF_COPY.manage}</span>
            <span aria-hidden="true">⋯</span>
        </button>
    );
}

/** The hero card for the group (or for the event it became). */
export function WfLfgHero({ group, event, onPrimary, onManage, onParticipants }: WfLfgHeroProps): JSX.Element {
    const badge = event ? WF_COPY.badgeEventSet : group.isViable ? WF_COPY.badgeFull : WF_COPY.badgeLooking;
    return (
        <div data-testid="wf-lfg-hero">
            <JourneyHero
                noRibbon
                tone={event ? 'set' : 'action'}
                donePillLabel={event ? 'Event set' : undefined}
                badge={badge}
                task={event ? `${event.label} · ${event.signupCount} signed up` : groupHeadline(group)}
                sub={event ? undefined : groupSub(group)}
                action={<WfParticipantsChip group={group} onOpen={onParticipants} />}
                headerActionBlock
                headerAction={
                    event
                        ? <HeroPrimary label={WF_COPY.openEvent} onClick={onPrimary} />
                        : <HeroPrimary label={WF_COPY.startSchedulingPoll} note={WF_COPY.pollNote} onClick={onPrimary} />
                }
                manage={<ManageButton onClick={onManage} />}
            />
        </div>
    );
}
