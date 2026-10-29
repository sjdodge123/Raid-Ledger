/**
 * ROK-1787/ROK-1830 S3c — the WoW **Raids** tab. The schedule, attendance and
 * event list it used to carry are core's now and live on the Events tab
 * (D8-B); what is left is the WoW-only half the approved prototype keeps here:
 * role composition and the bench for the next raid. Nothing was dropped from
 * the page — see the Raids-vs-Events table in the S3c handover.
 *
 * ROK-1817 — guild editors (`viewer.canEdit`: delegated members, admin,
 * operator) get a "Schedule for guild" link above the tab body, in every
 * query state. Plain members never see it. ROK-2050 puts the same link on
 * the core Events tab via the module's `eventsLead` (`schedule-for-guild.tsx`).
 */
import type { JSX } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { GuildRoleComposition } from './role-composition';
import { ScheduleForGuildRow } from './schedule-for-guild';

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
