/**
 * ROK-1787/ROK-1830 S3c — the WoW **Raids** tab. The schedule, attendance and
 * event list it used to carry are core's now and live on the Events tab
 * (D8-B); what is left is the WoW-only half the approved prototype keeps here:
 * role composition and the bench for the next raid. Nothing was dropped from
 * the page — see the Raids-vs-Events table in the S3c handover.
 *
 * ROK-1817 — guild editors (`viewer.canEdit`: delegated members, admin,
 * operator) get a "Schedule for guild" link above the tab body, in every
 * query state. Plain members never see it.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { UseQueryResult } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { buttonClass } from '../../../components/ui/button-classes';
import { GuildRoleComposition } from './role-composition';
import { scheduleForGuildUrl } from './raids-tab.helpers';

interface GuildRaidsTabProps {
    query: UseQueryResult<GuildRaidsDto, Error>;
    page: GuildPage;
}

export function GuildRaidsTab({ query, page }: GuildRaidsTabProps): JSX.Element {
    return (
        <div className="space-y-4">
            {page.viewer.canEdit && <ScheduleForGuildRow guild={page.guild} />}
            <RaidsBody query={query} />
        </div>
    );
}

/** Right-aligned at >=1024px; a full-width 44px target below. */
function ScheduleForGuildRow({ guild }: { guild: GuildPage['guild'] }): JSX.Element {
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

function RaidsBody({ query }: { query: UseQueryResult<GuildRaidsDto, Error> }): JSX.Element {
    if (query.error) {
        return <div className="py-12 text-center" data-testid="guild-raids-error"><p className="text-sm text-muted">We couldn&apos;t load this guild&apos;s raids. Try again in a moment.</p></div>;
    }
    const raids = query.data;
    if (!raids) return <div aria-busy="true" data-testid="guild-raids-loading" className="h-64 animate-pulse rounded-lg border border-edge bg-surface" />;
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="guild-raids-tab">
            <GuildRoleComposition composition={raids.composition} />
        </div>
    );
}
