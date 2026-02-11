import { useNavigate } from 'react-router-dom';
import type { EventListResponseDto } from '@raid-ledger/contract';
import { EventCard, EventCardSkeleton } from '../events/event-card';

interface SignedUpEventsGridProps {
    data: EventListResponseDto | undefined;
    isLoading: boolean;
}

export function SignedUpEventsGrid({ data, isLoading }: SignedUpEventsGridProps) {
    const navigate = useNavigate();

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 4 }).map((_, i) => (
                    <EventCardSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (!data || data.data.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-muted">
                    You haven't signed up for any upcoming events yet.
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {data.data.map((event) => (
                <EventCard
                    key={event.id}
                    event={event}
                    signupCount={event.signupCount}
                    onClick={() => navigate(`/events/${event.id}`)}
                />
            ))}
        </div>
    );
}
