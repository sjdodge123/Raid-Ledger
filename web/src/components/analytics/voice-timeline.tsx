import type { EventVoiceSessionDto, EventMetricsResponseDto } from '@raid-ledger/contract';

interface VoiceTimelineProps {
    metrics: EventMetricsResponseDto;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
    full: '#34D399',
    partial: '#60A5FA',
    late: '#FBBF24',
    early_leaver: '#FB923C',
    no_show: '#F87171',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
    full: 'Full',
    partial: 'Partial',
    late: 'Late',
    early_leaver: 'Early Leaver',
    no_show: 'No-Show',
};

export function VoiceTimeline({ metrics }: VoiceTimelineProps) {
    if (!metrics.voiceSummary || metrics.voiceSummary.sessions.length === 0) {
        return null;
    }

    const sessions = metrics.voiceSummary.sessions.filter(
        (s) => s.classification !== 'no_show',
    );

    if (sessions.length === 0) {
        return null;
    }

    const eventStart = new Date(metrics.startTime).getTime();
    const eventEnd = new Date(metrics.endTime).getTime();
    const eventDuration = eventEnd - eventStart;

    if (eventDuration <= 0) return null;

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">
                Voice Timeline
            </h3>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mb-4 text-xs">
                {Object.entries(CLASSIFICATION_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-1.5">
                        <div
                            className="w-3 h-3 rounded"
                            style={{ backgroundColor: CLASSIFICATION_COLORS[key] }}
                        />
                        <span className="text-muted">{label}</span>
                    </div>
                ))}
            </div>

            {/* Timeline bars */}
            <div className="space-y-2">
                {/* Time axis */}
                <div className="flex justify-between text-xs text-muted mb-1 pl-28 sm:pl-36">
                    <span>
                        {new Date(metrics.startTime).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </span>
                    <span>
                        {new Date(metrics.endTime).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </span>
                </div>

                {sessions.map((session) => (
                    <SessionBar
                        key={session.id}
                        session={session}
                        eventStart={eventStart}
                        eventDuration={eventDuration}
                    />
                ))}
            </div>
        </div>
    );
}

function SessionBar({
    session,
    eventStart,
    eventDuration,
}: {
    session: EventVoiceSessionDto;
    eventStart: number;
    eventDuration: number;
}) {
    const color =
        CLASSIFICATION_COLORS[session.classification ?? 'partial'] ??
        CLASSIFICATION_COLORS.partial;

    return (
        <div className="flex items-center gap-2">
            {/* Username label */}
            <div className="w-28 sm:w-36 text-xs text-muted truncate text-right">
                {session.discordUsername}
            </div>
            {/* Bar container */}
            <div className="flex-1 h-6 bg-panel rounded relative overflow-hidden">
                {session.segments.map((segment, idx) => {
                    const segStart = new Date(segment.joinAt).getTime();
                    const segEnd = segment.leaveAt
                        ? new Date(segment.leaveAt).getTime()
                        : segStart + segment.durationSec * 1000;

                    const leftPercent = Math.max(
                        0,
                        ((segStart - eventStart) / eventDuration) * 100,
                    );
                    const widthPercent = Math.min(
                        100 - leftPercent,
                        ((segEnd - segStart) / eventDuration) * 100,
                    );

                    return (
                        <div
                            key={idx}
                            className="absolute top-0 bottom-0 rounded"
                            style={{
                                left: `${leftPercent}%`,
                                width: `${Math.max(widthPercent, 0.5)}%`,
                                backgroundColor: color,
                                opacity: 0.8,
                            }}
                            title={`${new Date(segment.joinAt).toLocaleTimeString()} - ${
                                segment.leaveAt
                                    ? new Date(segment.leaveAt).toLocaleTimeString()
                                    : 'ongoing'
                            } (${formatDuration(segment.durationSec)})`}
                        />
                    );
                })}
            </div>
            {/* Duration label */}
            <div className="w-16 text-xs text-muted text-right">
                {formatDuration(session.totalDurationSec)}
            </div>
        </div>
    );
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
