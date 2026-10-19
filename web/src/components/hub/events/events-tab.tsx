/**
 * ROK-1830 S3c — the core **Events** tab (D7-A frame slot 3, D8-B: core owns
 * events/schedule/attendance through `events.guild_id`). Approved prototype
 * `eventsTab()`: every event tagged to the guild — raid or not — plus the
 * weekly schedule and the attendance leaderboard.
 *
 * Game-agnostic by construction: it reads only the core raids payload, so a
 * hub of any `kind` gets the same tab. The WoW module's Raids tab keeps the
 * WoW-only half (role composition) and no longer repeats these three widgets.
 */
import type { JSX } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { GuildKind, GuildRaidsDto } from '@raid-ledger/contract';
import { GuildAttendance } from './guild-attendance';
import { GuildEvents } from './guild-events';
import { GuildRaidSchedule } from './guild-raid-schedule';

interface EventsTabProps { query: UseQueryResult<GuildRaidsDto, Error>; kind?: GuildKind | undefined }

export function HubEventsTab({ query, kind }: EventsTabProps): JSX.Element {
    if (query.error) {
        return (
            <div className="py-12 text-center" data-testid="guild-events-error">
                <p className="text-sm text-muted">We couldn&apos;t load this guild&apos;s events. Try again in a moment.</p>
            </div>
        );
    }
    const raids = query.data;
    if (!raids) return <div aria-busy="true" data-testid="guild-events-loading" className="h-64 animate-pulse rounded-lg border border-edge bg-surface" />;
    return (
        <div className="flex flex-col gap-8" data-testid="guild-events-tab">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <GuildRaidSchedule schedule={raids.schedule} kind={kind} />
                <GuildAttendance attendance={raids.attendance} kind={kind} />
            </div>
            <GuildEvents raids={raids} />
        </div>
    );
}
