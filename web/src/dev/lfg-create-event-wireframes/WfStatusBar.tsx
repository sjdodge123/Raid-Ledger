/**
 * ROK-1573/1572 — dev-only variant of `LfgStatusBar`.
 *
 * The shipped bar's actions are fixed (`+1` / `Find a time`), so the proposed
 * Create event + Start a scheduling poll pair is drawn here. The left half,
 * the now strip and the join control are the REAL components.
 */
import type { JSX } from 'react';
import type { LfgConvertedEventDto, LfgGroupDetailDto } from '@raid-ledger/contract';
import { GroupSummary } from '../../pages/lfg/LfgGroupSummary';
import { LfgJoinControl } from '../../pages/lfg/LfgJoinControl';
import { LfgNowStrip } from '../../pages/lfg/LfgNowStrip';
import { LFG_COPY } from '../../pages/lfg/lfg-copy';
import { dayAndClock } from './wireframe-fixtures';
import { PRIMARY_BTN, SECONDARY_BTN, WF_COPY, type WfActionsLayout } from './wireframe-variants';

export interface WfStatusBarProps {
    group: LfgGroupDetailDto;
    layout: WfActionsLayout;
    /** Primary Create event label (L1b appends the best time). */
    createLabel: string;
    convertedEvent: LfgConvertedEventDto | null;
    onCreateEvent: () => void;
    onStartPoll: () => void;
}

/** The two new buttons, ordered and sized by layout. */
function ScheduleActions({ layout, createLabel, onCreateEvent, onStartPoll }: Omit<WfStatusBarProps, 'group' | 'convertedEvent'>): JSX.Element {
    const pollFirst = layout === 'poll-first';
    const width = layout === 'stacked' ? 'w-full' : '';
    const create = (
        <button key="create" type="button" className={`${pollFirst ? SECONDARY_BTN : PRIMARY_BTN} ${width}`} onClick={onCreateEvent}>
            {createLabel}
        </button>
    );
    const poll = (
        <button key="poll" type="button" className={`${pollFirst ? PRIMARY_BTN : SECONDARY_BTN} ${width}`} onClick={onStartPoll}>
            {WF_COPY.startSchedulingPoll}
        </button>
    );
    return (
        <div data-testid="wf-schedule-actions" className="space-y-1.5">
            <div className={layout === 'stacked' ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'}>
                {pollFirst ? [poll, create] : [create, poll]}
            </div>
            <p className="text-xs text-muted">{WF_COPY.actionsNote}</p>
        </div>
    );
}

/** L4 — the row a converted group gains. Neutral tokens, PendingPollCard-shaped. */
function ConvertedEventRow({ event }: { event: LfgConvertedEventDto }): JSX.Element {
    return (
        <div data-testid="wf-converted-event" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-overlay p-4">
            <p className="text-sm text-foreground">
                <span className="font-semibold">Event created</span>
                <span className="text-muted"> · {dayAndClock(event.startTime)} · {event.signupCount} signed up</span>
            </p>
            <a href={`/events/${event.eventId}`} onClick={(e) => e.preventDefault()} className="text-sm font-semibold text-emerald-400 hover:text-emerald-300">
                Open the event ›
            </a>
        </div>
    );
}

/** Proposed status bar: summary + join/withdraw, then the scheduling actions. */
export function WfStatusBar(props: WfStatusBarProps): JSX.Element {
    const { group, convertedEvent } = props;
    const stacked = props.layout === 'stacked';
    return (
        <div data-testid="lfg-status-bar" className="space-y-3 rounded-xl bg-surface p-4">
            <LfgNowStrip members={group.members} />
            <div className="flex flex-wrap items-center justify-between gap-4">
                <GroupSummary group={group} />
                {group.ownIntent != null ? (
                    <button type="button" className={SECONDARY_BTN}>{LFG_COPY.withdraw}</button>
                ) : (
                    <LfgJoinControl label={group.gameName} onJoin={() => undefined} className={PRIMARY_BTN} />
                )}
            </div>
            {convertedEvent && <ConvertedEventRow event={convertedEvent} />}
            <div className={stacked ? '' : 'flex justify-end'}>
                <ScheduleActions {...props} />
            </div>
        </div>
    );
}
