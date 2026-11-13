/**
 * Core "GG <year>" stat cards (ROK-2187): events, on time, rhythm, hours,
 * voice and hubs. Each renders only from a parsed payload; a zero-filled card
 * is never produced (the api omits it), and a zero tile is never drawn.
 */
import type { JSX } from 'react';
import type { GgEventsCard } from '@raid-ledger/contract';
import type { GgCardProps } from '../../gg-cards';
import { GgCardBody, GgChip, GgHuge, GgKicker, GgLede, GgStat, GgStats, GgTitle } from '../../../components/gg/gg-card-parts';
import { GgMonthHistogram, GgWeekStreak } from '../../../components/gg/gg-year-visuals';
import { ggDuration, ggHour, ggHours, ggMonth, ggPercent, ggPlural, ggWeekday } from '../../../components/gg/gg-format';

interface OnTime { attended: number; onTime: number; onTimeRatio: number; weeksAttended?: boolean[] | undefined }
interface Rhythm { busiestMonth: number; busiestMonthEvents: number; favouriteWeekday: number; favouriteHour: number }
interface Hours { totalSeconds: number; gamesPlayed: number; nightOwlShare?: number | undefined }
interface Voice { totalSeconds: number; sessions: number }
interface Hubs { joined: number; posts: number; pictures: number }

/** The Events card's no-show / created tiles — nothing at all when both are zero. */
function EventTiles({ noShows, created }: { noShows: number; created: number }): JSX.Element | null {
    if (noShows <= 0 && created <= 0) return null;
    return (
        <GgStats>
            {noShows > 0 && <GgStat value={noShows} label={ggPlural(noShows, 'no-show', 'no-shows')} />}
            {created > 0 && <GgStat value={created} label={ggPlural(created, 'event you created', 'events you created')} />}
        </GgStats>
    );
}

/** Card 2 — events attended. */
export function GgEventsCardView({ payload }: GgCardProps<GgEventsCard>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Events</GgKicker>
            <GgLede>You showed up to</GgLede>
            <GgHuge>{payload.attended}</GgHuge>
            <GgLede><strong>{ggPlural(payload.attended, 'event', 'events')}</strong> out of {payload.signedUp} you signed up for.</GgLede>
            {payload.eventsByMonth !== undefined && <GgMonthHistogram counts={payload.eventsByMonth} />}
            <EventTiles noShows={payload.noShows} created={payload.created ?? 0} />
        </GgCardBody>
    );
}

/** Card 3 — always on time. */
export function GgOnTimeCardView({ payload }: GgCardProps<OnTime>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Reliability</GgKicker>
            <GgTitle>{ggPercent(payload.onTimeRatio)} on time.</GgTitle>
            <GgLede>You were there for the start of <strong>{payload.onTime}</strong> of {payload.attended} events.</GgLede>
            {payload.weeksAttended !== undefined && <GgWeekStreak weeks={payload.weeksAttended} />}
            {payload.onTimeRatio >= 0.9 && <GgChip>⏱ Always on time</GgChip>}
        </GgCardBody>
    );
}

/** Card 4 — busiest month + favourite slot. */
export function GgRhythmCardView({ payload }: GgCardProps<Rhythm>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Your rhythm</GgKicker>
            <GgTitle>{ggMonth(payload.busiestMonth)} was your month.</GgTitle>
            <GgLede><strong>{payload.busiestMonthEvents} {ggPlural(payload.busiestMonthEvents, 'event', 'events')}</strong> — your busiest month of the year.</GgLede>
            <GgLede>Favourite slot: <strong>{ggWeekday(payload.favouriteWeekday)} {ggHour(payload.favouriteHour)}</strong>.</GgLede>
        </GgCardBody>
    );
}

/** Card 5 — hours played. */
export function GgHoursCardView({ payload }: GgCardProps<Hours>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Hours played</GgKicker>
            <GgHuge>{ggHours(payload.totalSeconds)}</GgHuge>
            <GgLede>across <strong>{payload.gamesPlayed} {ggPlural(payload.gamesPlayed, 'game', 'games')}</strong>.</GgLede>
            {payload.nightOwlShare !== undefined && payload.nightOwlShare > 0 && (
                <GgLede><strong>{ggPercent(payload.nightOwlShare)}</strong> of it after dark.</GgLede>
            )}
        </GgCardBody>
    );
}

/** Card 8 — event voice time. */
export function GgVoiceCardView({ payload }: GgCardProps<Voice>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Voice</GgKicker>
            <GgLede>You spent</GgLede>
            <GgHuge>{ggHours(payload.totalSeconds)}</GgHuge>
            <GgLede>in event voice — <strong>{ggDuration(payload.totalSeconds)}</strong> over {payload.sessions} {ggPlural(payload.sessions, 'session', 'sessions')}.</GgLede>
        </GgCardBody>
    );
}

/** Card 10 — hubs. */
export function GgHubsCardView({ payload }: GgCardProps<Hubs>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Hubs</GgKicker>
            <GgTitle>You made the hubs louder</GgTitle>
            {(payload.posts > 0 || payload.pictures > 0 || payload.joined > 0) && (
                <GgStats>
                    {payload.posts > 0 && <GgStat value={payload.posts} label={ggPlural(payload.posts, 'post', 'posts')} />}
                    {payload.pictures > 0 && <GgStat value={payload.pictures} label={ggPlural(payload.pictures, 'picture', 'pictures')} />}
                    {payload.joined > 0 && <GgStat value={payload.joined} label={ggPlural(payload.joined, 'hub joined', 'hubs joined')} />}
                </GgStats>
            )}
        </GgCardBody>
    );
}
