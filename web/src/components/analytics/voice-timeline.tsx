import type { EventVoiceSessionDto, EventMetricsResponseDto } from '@raid-ledger/contract';
import { formatDuration } from '../../lib/format-duration';

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

function TimelineLegend() {
    return (
        <div className="flex flex-wrap gap-4 mb-4 text-xs">
            {Object.entries(CLASSIFICATION_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: CLASSIFICATION_COLORS[key] }} />
                    <span className="text-muted">{label}</span>
                </div>
            ))}
        </div>
    );
}

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function VoiceTimeline({ metrics }: VoiceTimelineProps) {
    if (!metrics.voiceSummary || metrics.voiceSummary.sessions.length === 0) return null;

    const sessions = metrics.voiceSummary.sessions.filter((s) => s.classification !== 'no_show');
    if (sessions.length === 0) return null;

    const eventStart = new Date(metrics.startTime).getTime();
    const eventEnd = new Date(metrics.endTime).getTime();
    const eventDuration = eventEnd - eventStart;
    if (eventDuration <= 0) return null;

    return (
        <div className="bg-surface rounded-lg border border-edge p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Voice Timeline</h3>
            <TimelineLegend />
            <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted mb-1 pl-28 sm:pl-36">
                    <span>{formatTime(metrics.startTime)}</span>
                    <span>{formatTime(metrics.endTime)}</span>
                </div>
                {sessions.map((session) => (
                    <SessionBar key={session.id} session={session} eventStart={eventStart} eventDuration={eventDuration} />
                ))}
            </div>
        </div>
    );
}

function computeSegmentPosition(segment: { joinAt: string; leaveAt?: string | null; durationSec: number }, eventStart: number, eventDuration: number) {
    const segStart = new Date(segment.joinAt).getTime();
    const segEnd = segment.leaveAt ? new Date(segment.leaveAt).getTime() : segStart + segment.durationSec * 1000;
    const leftPercent = Math.max(0, ((segStart - eventStart) / eventDuration) * 100);
    const widthPercent = Math.min(100 - leftPercent, ((segEnd - segStart) / eventDuration) * 100);
    return { leftPercent, widthPercent };
}

function segmentTitle(segment: { joinAt: string; leaveAt?: string | null; durationSec: number }) {
    const end = segment.leaveAt ? new Date(segment.leaveAt).toLocaleTimeString() : 'ongoing';
    return `${new Date(segment.joinAt).toLocaleTimeString()} - ${end} (${formatDuration(segment.durationSec)})`;
}

function SessionBar({ session, eventStart, eventDuration }: { session: EventVoiceSessionDto; eventStart: number; eventDuration: number }) {
    const color = CLASSIFICATION_COLORS[session.classification ?? 'partial'] ?? CLASSIFICATION_COLORS.partial;

    return (
        <div className="flex items-center gap-2">
            <div className="w-28 sm:w-36 text-xs text-muted truncate text-right">{session.discordUsername}</div>
            <div className="flex-1 h-6 bg-panel rounded relative overflow-hidden">
                {session.segments.map((segment, idx) => {
                    const { leftPercent, widthPercent } = computeSegmentPosition(segment, eventStart, eventDuration);
                    return (
                        <div
                            key={idx}
                            className="absolute top-0 bottom-0 rounded"
                            style={{ left: `${leftPercent}%`, width: `${Math.max(widthPercent, 0.5)}%`, backgroundColor: color, opacity: 0.8 }}
                            title={segmentTitle(segment)}
                        />
                    );
                })}
            </div>
            <div className="w-16 text-xs text-muted text-right">{formatDuration(session.totalDurationSec)}</div>
        </div>
    );
}
