import { Link, useParams } from 'react-router-dom';
import { useEventMetrics } from '../hooks/use-analytics';
import { EventAttendanceDonut } from '../components/analytics/event-attendance-donut';
import { VoiceTimeline } from '../components/analytics/voice-timeline';
import { RosterBreakdownTable } from '../components/analytics/roster-breakdown-table';

export function EventMetricsPage() {
    const { id } = useParams<{ id: string }>();
    const eventId = Number(id);
    const { data: metrics, isLoading, error } = useEventMetrics(eventId);

    if (isLoading) return <MetricsLoadingSkeleton />;
    if (error) return <MetricsError eventId={eventId} message={error.message} />;
    if (!metrics) return null;

    return (
        <div className="py-8 px-4">
            <div className="max-w-5xl mx-auto">
                <MetricsHeader eventId={eventId} title={metrics.title} startTime={metrics.startTime} gameName={metrics.game?.name} />
                <div className="space-y-6">
                    <EventAttendanceDonut summary={metrics.attendanceSummary} />
                    <VoiceTimeline metrics={metrics} />
                    <RosterBreakdownTable roster={metrics.rosterBreakdown} hasVoiceData={metrics.voiceSummary !== null} />
                </div>
            </div>
        </div>
    );
}

function MetricsLoadingSkeleton() {
    return (
        <div className="py-8 px-4">
            <div className="max-w-5xl mx-auto">
                <div className="animate-pulse space-y-6">
                    <div className="h-8 bg-panel rounded w-64" />
                    <div className="h-64 bg-panel rounded" />
                    <div className="h-48 bg-panel rounded" />
                </div>
            </div>
        </div>
    );
}

function MetricsError({ eventId, message }: { eventId: number; message: string }) {
    return (
        <div className="min-h-[50vh] flex items-center justify-center">
            <div className="text-center">
                <h2 className="text-xl font-semibold text-red-400 mb-2">Failed to load event metrics</h2>
                <p className="text-muted">{message}</p>
                <Link to={`/events/${eventId}`} className="mt-4 inline-block text-emerald-400 hover:text-emerald-300">Back to event</Link>
            </div>
        </div>
    );
}

function MetricsHeader({ eventId, title, startTime, gameName }: { eventId: number; title: string; startTime: string; gameName?: string }) {
    const eventDate = new Date(startTime).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return (
        <div className="mb-6">
            <Link to={`/events/${eventId}`} className="text-sm text-emerald-400 hover:text-emerald-300 mb-2 inline-block">&larr; Back to event</Link>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{title}</h1>
            <div className="flex flex-wrap gap-3 mt-2 text-sm text-muted">
                <span>{eventDate}</span>
                {gameName && <span className="px-2 py-0.5 bg-panel rounded text-xs">{gameName}</span>}
            </div>
        </div>
    );
}
