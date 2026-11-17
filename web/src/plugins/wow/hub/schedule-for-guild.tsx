/**
 * ROK-1817 / ROK-2050 — the "Schedule for guild" link. Guild editors
 * (`viewer.canEdit`: delegated members, admin, operator) get it on the WoW
 * Raids tab and, through the WoW module's `eventsLead` slot, on the core
 * Events tab. Plain members never see it. One component, two placements.
 * ROK-2212: on a Forever guild hub the slot also lists the hub's open polls.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { GuildPage } from '@raid-ledger/contract';
import { buttonClass } from '../../../components/ui/button-classes';
import type { HubCtx } from '../../hub-module';
import { scheduleForGuildUrl } from './raids-tab.helpers';
import { isForeverGuildPage } from '../lib/forever-identity';
import { ForeverHubPolls } from './forever-hub-polls';

/** Right-aligned at >=1024px; a full-width 44px target below. */
export function ScheduleForGuildRow({ guild }: { guild: GuildPage['guild'] }): JSX.Element {
    return (
        <div className="flex justify-end">
            <Link
                to={scheduleForGuildUrl(guild)}
                data-testid="guild-schedule-for-guild"
                className={buttonClass({ variant: 'secondary', size: 'sm', className: 'w-full lg:w-auto' })}
            >
                <CalendarDaysIcon className="h-4 w-4" aria-hidden="true" />
                Schedule for guild
            </Link>
        </div>
    );
}

/**
 * The WoW module's `eventsLead` slot: the link for editors, then (Forever guild
 * hubs only, ROK-2212) the hub's open polls. Nothing for a plain member elsewhere.
 */
export function WowEventsLead({ page }: Pick<HubCtx, 'page'>): JSX.Element | null {
    const schedule = page.viewer.canEdit ? <ScheduleForGuildRow guild={page.guild} /> : null;
    if (!isForeverGuildPage(page)) return schedule;
    return (
        <div className="space-y-4">
            {schedule}
            <ForeverHubPolls page={page} />
        </div>
    );
}
