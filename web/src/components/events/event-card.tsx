import type { EventResponseDto } from '@raid-ledger/contract';

interface EventCardProps {
    event: EventResponseDto;
    signupCount?: number;
    onClick?: () => void;
}

/**
 * Format date/time in user's local timezone
 */
function formatEventTime(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(date);
}

/**
 * Handle image load errors by hiding the broken image
 */
function handleImageError(e: React.SyntheticEvent<HTMLImageElement>) {
    e.currentTarget.style.display = 'none';
}

/**
 * Event card component displaying event info with game cover
 */
export function EventCard({ event, signupCount = 0, onClick }: EventCardProps) {
    const gameCoverUrl = event.game?.coverUrl || null;

    return (
        <div
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick?.();
                }
            }}
            role="button"
            tabIndex={0}
            className="group cursor-pointer bg-slate-900 rounded-lg border border-slate-700 overflow-hidden hover:border-slate-500 focus:border-emerald-500 focus:outline-none transition-colors"
        >
            {/* Game Cover */}
            <div className="aspect-[3/4] relative overflow-hidden bg-slate-800">
                {gameCoverUrl ? (
                    <img
                        src={gameCoverUrl}
                        alt={event.game?.name || 'Event'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        onError={handleImageError}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-slate-600">
                        🎮
                    </div>
                )}
                {event.game && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                        <span className="text-sm text-slate-300">{event.game.name}</span>
                    </div>
                )}
            </div>

            {/* Event Info */}
            <div className="p-4">
                <h3 className="font-semibold text-white text-lg mb-2 line-clamp-2">
                    {event.title}
                </h3>

                <p className="text-slate-400 text-sm mb-3">
                    {formatEventTime(event.startTime)}
                </p>

                <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-400 font-medium">
                        {signupCount} signed up
                    </span>

                    <div className="flex items-center gap-1">
                        <img
                            src={event.creator.avatar || '/default-avatar.png'}
                            alt={event.creator.username}
                            className="w-6 h-6 rounded-full bg-slate-700"
                            onError={(e) => {
                                e.currentTarget.src = '/default-avatar.png';
                            }}
                        />
                        <span className="text-xs text-slate-500">
                            by {event.creator.username}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Skeleton loader for event cards during loading state
 */
export function EventCardSkeleton() {
    return (
        <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden animate-pulse">
            <div className="aspect-[3/4] bg-slate-800" />
            <div className="p-4 space-y-3">
                <div className="h-6 bg-slate-800 rounded w-3/4" />
                <div className="h-4 bg-slate-800 rounded w-1/2" />
                <div className="h-4 bg-slate-800 rounded w-1/4" />
            </div>
        </div>
    );
}
