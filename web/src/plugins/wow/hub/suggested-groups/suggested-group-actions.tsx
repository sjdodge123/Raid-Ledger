/**
 * ROK-2212 — a suggested group's actions: Schedule (ROK-2215 Create Event
 * pre-fill, claimed members invited, "Invites N of 5"), Poll (the caller's
 * `onPoll` opens the scheduling poll) and Open in planner (ROK-2216 link).
 * Schedule (primary) + Poll only when `canAct` (spec L9). Full-width stack below
 * 1024px; from 1024px one line with Open in planner right-aligned (mockup).
 * Below `DESKTOP_MQ` Schedule and Poll first open a confirm sheet (operator
 * 2026-11-19: the stacked full-width buttons are easy to mis-tap on a phone).
 */
import { useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GuildPage, SuggestedGroupDto } from '@raid-ledger/contract';
import { Button } from '../../../../components/ui/button';
import { buttonClass } from '../../../../components/ui/button-classes';
import { useMediaQuery } from '../../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../../lib/breakpoints';
import { SuggestedGroupConfirm, type SuggestedGroupConfirmKind } from './suggested-group-confirm';
import { groupLabel, inviteCharacterIds, inviteNote, plannerHref, scheduleHref, type GroupOrdinal } from './suggested-groups-links';

export interface SuggestedGroupActionProps {
    group: SuggestedGroupDto;
    page: Pick<GuildPage, 'guild'>;
    /** The viewer can start events and polls (members + staff); false hides Schedule + Poll. */
    canAct: boolean;
    /** Opens the scheduling poll for this group; omitted = no Poll button. */
    onPoll?: ((group: SuggestedGroupDto) => void) | undefined;
    /** Inside the planner tab: load the group in place instead of following the link. */
    onOpenInPlanner?: ((group: SuggestedGroupDto) => void) | undefined;
    /** Position among the dungeon's shown groups (planner section, >1 group) — keeps accessible names distinct. */
    ordinal?: GroupOrdinal | undefined;
}

const ACTION_CLS = 'w-full lg:w-auto';
/** Mockup: "Open in planner →" sits right-aligned on the actions line from 1024px. */
const PLANNER_CLS = 'w-full lg:ml-auto lg:w-auto';
const PLANNER_TEXT = <>Open in planner <span aria-hidden="true">→</span></>;

type ScheduleProps = Pick<SuggestedGroupActionProps, 'group' | 'page' | 'ordinal'> & {
    /** Phone: Schedule is a button that asks first; omitted = the plain Create Event link. */
    onAsk?: (() => void) | undefined;
};

function ScheduleAction({ group, page, ordinal, onAsk }: ScheduleProps): JSX.Element {
    const note = inviteNote(inviteCharacterIds(group).length);
    const target = ordinal === undefined ? group.instance.name : groupLabel(group, ordinal);
    const label = `Schedule ${target}${note === null ? '' : `, ${note.toLowerCase()}`}`;
    return (
        <span className="flex w-full flex-col gap-1 lg:w-auto">
            {onAsk === undefined ? (
                <Link to={scheduleHref(group, page)} aria-label={label} data-testid="suggested-group-schedule"
                    className={buttonClass({ variant: 'primary', size: 'sm', className: ACTION_CLS })}>
                    Schedule
                </Link>
            ) : (
                <Button variant="primary" size="sm" className={ACTION_CLS} aria-label={label}
                    data-testid="suggested-group-schedule" onClick={onAsk}>
                    Schedule
                </Button>
            )}
            {note !== null && <span className="text-xs text-muted" data-testid="suggested-group-invites">{note}</span>}
        </span>
    );
}

function PlannerAction({ group, page, onOpenInPlanner, ordinal }: SuggestedGroupActionProps): JSX.Element {
    // Label in Name (WCAG 2.5.3): the visible "Open in planner" leads the accessible name.
    const label = `Open in planner: ${groupLabel(group, ordinal)}`;
    if (onOpenInPlanner !== undefined) {
        return (
            <Button variant="ghost" size="sm" className={PLANNER_CLS} aria-label={label} onClick={() => onOpenInPlanner(group)}>
                {PLANNER_TEXT}
            </Button>
        );
    }
    // Plain <a>: the hub's tab follows hashchange, which a router <Link> never fires (card-bits.tsx).
    return (
        <a href={plannerHref(group, page.guild.id)} aria-label={label} data-testid="suggested-group-planner"
            className={buttonClass({ variant: 'ghost', size: 'sm', className: PLANNER_CLS })}>
            {PLANNER_TEXT}
        </a>
    );
}

/** Phone-only confirm state: which action is waiting on Continue, and what Continue does. */
function useActionConfirm({ group, page, onPoll }: SuggestedGroupActionProps) {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const navigate = useNavigate();
    const [asking, setAsking] = useState<SuggestedGroupConfirmKind | null>(null);
    const proceed = (): void => {
        setAsking(null);
        if (asking === 'schedule') void navigate(scheduleHref(group, page));
        else if (asking === 'poll') onPoll?.(group);
    };
    return { isDesktop, asking, setAsking, proceed };
}

/** The actions row. */
export function SuggestedGroupActions(props: SuggestedGroupActionProps): JSX.Element {
    const { group, canAct, onPoll, ordinal } = props;
    const { isDesktop, asking, setAsking, proceed } = useActionConfirm(props);
    const poll = (): void => (isDesktop ? onPoll?.(group) : setAsking('poll'));
    return (
        <div className="mt-1 flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-start">
            {canAct && <ScheduleAction group={group} page={props.page} ordinal={ordinal}
                onAsk={isDesktop ? undefined : () => setAsking('schedule')} />}
            {canAct && onPoll !== undefined && (
                <Button variant="secondary" size="sm" className={ACTION_CLS} aria-label={`Poll ${groupLabel(group, ordinal)}`}
                    data-testid="suggested-group-poll" onClick={poll}>
                    Poll
                </Button>
            )}
            <PlannerAction {...props} />
            {asking !== null && !isDesktop && (
                <SuggestedGroupConfirm kind={asking} group={group} onConfirm={proceed} onClose={() => setAsking(null)} />
            )}
        </div>
    );
}
