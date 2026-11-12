/**
 * Core "GG <year>" stat cards (ROK-2187): events, on time, rhythm, hours,
 * voice and hubs. Each renders only from a parsed payload; a zero-filled card
 * is never produced (the api omits it).
 */
import type { JSX } from 'react';
import type { GgEventsCard } from '@raid-ledger/contract';
import type { GgCardProps } from '../../gg-cards';
import { GgCardBody, GgChip, GgHuge, GgKicker, GgLede, GgStat, GgStats, GgTitle } from '../../../components/gg/gg-card-parts';
import { ggDuration, ggHour, ggHours, ggMonth, ggPercent, ggWeekday } from '../../../components/gg/gg-format';

interface OnTime { attended: number; onTime: number; onTimeRatio: number }
interface Rhythm { busiestMonth: number; busiestMonthEvents: number; favouriteWeekday: number; favouriteHour: number }
interface Hours { totalSeconds: number; gamesPlayed: number; nightOwlShare?: number | undefined }
interface Voice { totalSeconds: number; sessions: number }
interface Hubs { joined: number; posts: number; pictures: number }

/** Card 2 — events attended. */
export function GgEventsCardView({ payload }: GgCardProps<GgEventsCard>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Events</GgKicker>
            <GgLede>You showed up to</GgLede>
            <GgHuge>{payload.attended}</GgHuge>
            <GgLede><strong>events</strong> out of {payload.signedUp} you signed up for.</GgLede>
            <GgStats>
                <GgStat value={payload.noShows} label="no-shows" />
                {payload.created !== undefined && <GgStat value={payload.created} label="events you created" />}
            </GgStats>
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
            <GgLede><strong>{payload.busiestMonthEvents} events</strong> — your busiest month of the year.</GgLede>
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
            <GgLede>across <strong>{payload.gamesPlayed} games</strong>.</GgLede>
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
            <GgLede>in event voice — <strong>{ggDuration(payload.totalSeconds)}</strong> over {payload.sessions} sessions.</GgLede>
        </GgCardBody>
    );
}

/** Card 10 — hubs. */
export function GgHubsCardView({ payload }: GgCardProps<Hubs>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>Hubs</GgKicker>
            <GgTitle>You made the hubs louder</GgTitle>
            <GgStats>
                <GgStat value={payload.posts} label="posts" />
                <GgStat value={payload.pictures} label="pictures" />
                <GgStat value={payload.joined} label="hubs joined" />
            </GgStats>
        </GgCardBody>
    );
}
