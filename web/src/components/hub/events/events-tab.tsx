/**
 * ROK-1830 S3c — the core **Events** tab (D7-A frame slot 3, D8-B: core owns
 * events/schedule/attendance through `events.guild_id`). Approved prototype
 * `eventsTab()`: every event tagged to the guild — raid or not — plus the
 * weekly schedule and the attendance leaderboard.
 *
 * Game-agnostic by construction: it reads only the core raids payload, so a
 * hub of any `kind` gets the same tab. The WoW module's Raids tab keeps the
 * WoW-only half (role composition) and no longer repeats these three widgets.
 *
 * ROK-1893 P3: a community hub (`game_community`) also lists its open
 * scheduling polls above the events, with "New poll" for live members.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { GuildKind, GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { GuildAttendance } from './guild-attendance';
import { GuildEvents } from './guild-events';
import { GuildRaidSchedule } from './guild-raid-schedule';

/** Community hubs only — its own chunk, so the hub page bundle stays in budget. */
const HubPollsSection = lazy(() => import('./hub-polls-section').then((m) => ({ default: m.HubPollsSection })));

interface EventsTabProps {
    query: UseQueryResult<GuildRaidsDto, Error>;
    kind?: GuildKind | undefined;
    /** ROK-1893 P3: the hub page payload — a community hub shows its open polls. */
    page?: GuildPage | undefined;
}

function CommunityPolls({ page }: { page: GuildPage | undefined }): JSX.Element | null {
    if (page?.guild.kind !== 'game_community') return null;
    const { guild } = page;
    return (
        <Suspense fallback={null}>
            <HubPollsSection hubId={guild.id} hubName={guild.name} gameId={guild.gameId} canCreate={page.community?.viewerJoined === true} />
        </Suspense>
    );
}

export function HubEventsTab({ query, kind, page }: EventsTabProps): JSX.Element {
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
            <CommunityPolls page={page} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <GuildRaidSchedule schedule={raids.schedule} kind={kind} />
                <GuildAttendance attendance={raids.attendance} kind={kind} />
            </div>
            <GuildEvents raids={raids} kind={kind} />
        </div>
    );
}
