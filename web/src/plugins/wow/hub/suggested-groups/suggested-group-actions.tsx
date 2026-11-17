/**
 * ROK-2212 — a suggested group's actions: Schedule (ROK-2215 Create Event
 * pre-fill, claimed members invited, "Invites N of 5"), Poll (the caller's
 * `onPoll` opens the scheduling poll) and Open in planner (ROK-2216 link).
 * Schedule + Poll only when `canAct` (spec L9). Full-width stack below 1024px.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { GuildPage, SuggestedGroupDto } from '@raid-ledger/contract';
import { Button } from '../../../../components/ui/button';
import { buttonClass } from '../../../../components/ui/button-classes';
import { inviteCharacterIds, inviteNote, plannerHref, scheduleHref } from './suggested-groups-links';

export interface SuggestedGroupActionProps {
    group: SuggestedGroupDto;
    page: Pick<GuildPage, 'guild'>;
    /** The viewer can start events and polls (members + staff); false hides Schedule + Poll. */
    canAct: boolean;
    /** Opens the scheduling poll for this group; omitted = no Poll button. */
    onPoll?: ((group: SuggestedGroupDto) => void) | undefined;
    /** Inside the planner tab: load the group in place instead of following the link. */
    onOpenInPlanner?: ((group: SuggestedGroupDto) => void) | undefined;
}

const ACTION_CLS = 'w-full lg:w-auto';

function ScheduleAction({ group, page }: Pick<SuggestedGroupActionProps, 'group' | 'page'>): JSX.Element {
    const note = inviteNote(inviteCharacterIds(group).length);
    const label = `Schedule ${group.instance.name}${note === null ? '' : `, ${note.toLowerCase()}`}`;
    return (
        <span className="flex w-full flex-col gap-1 lg:w-auto">
            <Link to={scheduleHref(group, page)} aria-label={label} data-testid="suggested-group-schedule"
                className={buttonClass({ variant: 'secondary', size: 'sm', className: ACTION_CLS })}>
                Schedule
            </Link>
            {note !== null && <span className="text-xs text-muted" data-testid="suggested-group-invites">{note}</span>}
        </span>
    );
}

function PlannerAction({ group, page, onOpenInPlanner }: SuggestedGroupActionProps): JSX.Element {
    const label = `Open ${group.instance.name} group in the planner`;
    if (onOpenInPlanner !== undefined) {
        return (
            <Button variant="ghost" size="sm" className={ACTION_CLS} aria-label={label} onClick={() => onOpenInPlanner(group)}>
                Open in planner
            </Button>
        );
    }
    // Plain <a>: the hub's tab follows hashchange, which a router <Link> never fires (card-bits.tsx).
    return (
        <a href={plannerHref(group, page.guild.id)} aria-label={label} data-testid="suggested-group-planner"
            className={buttonClass({ variant: 'ghost', size: 'sm', className: ACTION_CLS })}>
            Open in planner
        </a>
    );
}

/** The actions row. */
export function SuggestedGroupActions(props: SuggestedGroupActionProps): JSX.Element {
    const { group, canAct, onPoll } = props;
    return (
        <div className="mt-1 flex flex-col items-stretch gap-2 lg:flex-row lg:flex-wrap lg:items-start">
            {canAct && <ScheduleAction group={group} page={props.page} />}
            {canAct && onPoll !== undefined && (
                <Button variant="secondary" size="sm" className={ACTION_CLS} aria-label={`Poll ${group.instance.name} group`}
                    data-testid="suggested-group-poll" onClick={() => onPoll(group)}>
                    Poll
                </Button>
            )}
            <PlannerAction {...props} />
        </div>
    );
}
