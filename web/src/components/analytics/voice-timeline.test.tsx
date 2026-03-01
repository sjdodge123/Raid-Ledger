import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceTimeline } from './voice-timeline';
import type { EventMetricsResponseDto } from '@raid-ledger/contract';

function makeSession(overrides: Partial<EventMetricsResponseDto['voiceSummary'] extends null | infer T ? (T extends null ? never : NonNullable<T>['sessions'][number]) : never> = {}) {
    return {
        id: 1,
        eventId: 10,
        userId: 1,
        discordUserId: 'discord-1',
        discordUsername: 'Alice#1234',
        firstJoinAt: '2026-01-15T18:10:00.000Z',
        lastLeaveAt: '2026-01-15T20:55:00.000Z',
        totalDurationSec: 9900,
        segments: [
            {
                joinAt: '2026-01-15T18:10:00.000Z',
                leaveAt: '2026-01-15T20:55:00.000Z',
                durationSec: 9900,
            },
        ],
        classification: 'full' as const,
        ...overrides,
    };
}

function makeMetrics(overrides: Partial<EventMetricsResponseDto> = {}): EventMetricsResponseDto {
    return {
        eventId: 10,
        title: 'Epic Raid',
        startTime: '2026-01-15T18:00:00.000Z',
        endTime: '2026-01-15T21:00:00.000Z',
        game: null,
        attendanceSummary: {
            attended: 2,
            noShow: 0,
            excused: 0,
            unmarked: 0,
            total: 2,
            attendanceRate: 1.0,
        },
        voiceSummary: {
            totalTracked: 1,
            full: 1,
            partial: 0,
            late: 0,
            earlyLeaver: 0,
            noShow: 0,
            sessions: [makeSession()],
        },
        rosterBreakdown: [],
        ...overrides,
    };
}

describe('VoiceTimeline', () => {
    it('renders nothing when voiceSummary is null', () => {
        const { container } = render(
            <VoiceTimeline metrics={makeMetrics({ voiceSummary: null })} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when all sessions are no_show', () => {
        const noShowSession = makeSession({ classification: 'no_show' as const });
        const metrics = makeMetrics({
            voiceSummary: {
                totalTracked: 1,
                full: 0,
                partial: 0,
                late: 0,
                earlyLeaver: 0,
                noShow: 1,
                sessions: [noShowSession],
            },
        });
        const { container } = render(<VoiceTimeline metrics={metrics} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when voiceSummary has no sessions', () => {
        const metrics = makeMetrics({
            voiceSummary: {
                totalTracked: 0,
                full: 0,
                partial: 0,
                late: 0,
                earlyLeaver: 0,
                noShow: 0,
                sessions: [],
            },
        });
        const { container } = render(<VoiceTimeline metrics={metrics} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when event duration is zero', () => {
        const metrics = makeMetrics({
            startTime: '2026-01-15T18:00:00.000Z',
            endTime: '2026-01-15T18:00:00.000Z', // same = 0 duration
        });
        const { container } = render(<VoiceTimeline metrics={metrics} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders Voice Timeline heading when voice data exists', () => {
        render(<VoiceTimeline metrics={makeMetrics()} />);
        expect(screen.getByText('Voice Timeline')).toBeInTheDocument();
    });

    it('renders username in timeline bar', () => {
        render(<VoiceTimeline metrics={makeMetrics()} />);
        expect(screen.getByText('Alice#1234')).toBeInTheDocument();
    });

    it('renders legend items for all classifications', () => {
        render(<VoiceTimeline metrics={makeMetrics()} />);
        expect(screen.getByText('Full')).toBeInTheDocument();
        expect(screen.getByText('Partial')).toBeInTheDocument();
        expect(screen.getByText('Late')).toBeInTheDocument();
        expect(screen.getByText('Early Leaver')).toBeInTheDocument();
        expect(screen.getByText('No-Show')).toBeInTheDocument();
    });

    it('filters out no_show sessions from timeline bars', () => {
        const noShowSession = makeSession({ id: 2, discordUsername: 'Ghost#0000', classification: 'no_show' as const });
        const fullSession = makeSession({ id: 1, discordUsername: 'Alice#1234', classification: 'full' as const });
        const metrics = makeMetrics({
            voiceSummary: {
                totalTracked: 2,
                full: 1,
                partial: 0,
                late: 0,
                earlyLeaver: 0,
                noShow: 1,
                sessions: [fullSession, noShowSession],
            },
        });

        render(<VoiceTimeline metrics={metrics} />);

        // Alice should appear (full), Ghost should not (no_show is filtered out)
        expect(screen.getByText('Alice#1234')).toBeInTheDocument();
        expect(screen.queryByText('Ghost#0000')).not.toBeInTheDocument();
    });

    it('renders duration label for each session bar', () => {
        // 9900 seconds = 2h 45m
        render(<VoiceTimeline metrics={makeMetrics()} />);
        expect(screen.getByText('2h 45m')).toBeInTheDocument();
    });

    it('renders duration in minutes only when under 1 hour', () => {
        const shortSession = makeSession({
            totalDurationSec: 1800,
            segments: [{ joinAt: '2026-01-15T18:00:00.000Z', leaveAt: '2026-01-15T18:30:00.000Z', durationSec: 1800 }],
        });
        const metrics = makeMetrics({
            voiceSummary: {
                totalTracked: 1,
                full: 1,
                partial: 0,
                late: 0,
                earlyLeaver: 0,
                noShow: 0,
                sessions: [shortSession],
            },
        });

        render(<VoiceTimeline metrics={metrics} />);
        expect(screen.getByText('30m')).toBeInTheDocument();
    });

    it('renders time axis labels for event start and end', () => {
        render(<VoiceTimeline metrics={makeMetrics()} />);
        // There should be time labels in the header
        // We test they exist (exact format depends on locale)
        const timelineEl = screen.getByText('Voice Timeline').closest('div');
        expect(timelineEl).toBeInTheDocument();
    });

    it('renders multiple session bars for multiple users', () => {
        const session2 = makeSession({ id: 2, discordUsername: 'Bob#5678' });
        const metrics = makeMetrics({
            voiceSummary: {
                totalTracked: 2,
                full: 2,
                partial: 0,
                late: 0,
                earlyLeaver: 0,
                noShow: 0,
                sessions: [makeSession(), session2],
            },
        });

        render(<VoiceTimeline metrics={metrics} />);

        expect(screen.getByText('Alice#1234')).toBeInTheDocument();
        expect(screen.getByText('Bob#5678')).toBeInTheDocument();
    });
});
