/**
 * ROK-1787 — the Raids tab (prototype `layout/TabPanels.tsx` `RaidsTab`):
 * schedule + composition two-up, attendance across both, then the full events.
 */
import type { JSX } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { GuildRaidsDto } from '@raid-ledger/contract';
import { GuildAttendance } from '../../../components/hub/events/guild-attendance';
import { GuildEvents } from '../../../components/hub/events/guild-events';
import { GuildRaidSchedule } from '../../../components/hub/events/guild-raid-schedule';
import { GuildRoleComposition } from './role-composition';

export function GuildRaidsTab({ query }: { query: UseQueryResult<GuildRaidsDto, Error> }): JSX.Element {
    if (query.error) {
        return <div className="py-12 text-center" data-testid="guild-raids-error"><p className="text-sm text-muted">We couldn&apos;t load this guild&apos;s raids. Try again in a moment.</p></div>;
    }
    const raids = query.data;
    if (!raids) return <div aria-busy="true" data-testid="guild-raids-loading" className="h-64 animate-pulse rounded-lg border border-edge bg-surface" />;
    return (
        <div className="flex flex-col gap-8" data-testid="guild-raids-tab">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <GuildRaidSchedule schedule={raids.schedule} />
                <GuildRoleComposition composition={raids.composition} />
                <div className="md:col-span-2"><GuildAttendance attendance={raids.attendance} /></div>
            </div>
            <GuildEvents raids={raids} />
        </div>
    );
}
