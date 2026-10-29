/**
 * ROK-1817 / ROK-2050 — the "Schedule for guild" link. Guild editors
 * (`viewer.canEdit`: delegated members, admin, operator) get it on the WoW
 * Raids tab and, through the WoW module's `eventsLead` slot, on the core
 * Events tab. Plain members never see it. One component, two placements.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { GuildPage } from '@raid-ledger/contract';
import { buttonClass } from '../../../components/ui/button-classes';
import type { HubCtx } from '../../hub-module';
import { scheduleForGuildUrl } from './raids-tab.helpers';

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

/** The WoW module's `eventsLead` slot: the link for editors, nothing for anyone else. */
export function WowEventsLead({ page }: Pick<HubCtx, 'page'>): JSX.Element | null {
    return page.viewer.canEdit ? <ScheduleForGuildRow guild={page.guild} /> : null;
}
