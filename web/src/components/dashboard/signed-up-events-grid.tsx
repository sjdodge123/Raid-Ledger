import { useNavigate } from 'react-router-dom';
import type { EventListResponseDto } from '@raid-ledger/contract';
import { EventCard, EventCardSkeleton } from '../events/event-card';

interface SignedUpEventsGridProps {
    data: EventListResponseDto | undefined;
    isLoading: boolean;
}

const GRID_CLASS = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6';

function SignedUpEventsGridSkeleton() {
    return (
        <div className={GRID_CLASS}>
            {Array.from({ length: 4 }).map((_, i) => (
                <EventCardSkeleton key={i} />
            ))}
        </div>
    );
}

export function SignedUpEventsGrid({ data, isLoading }: SignedUpEventsGridProps) {
    const navigate = useNavigate();

    if (isLoading) return <SignedUpEventsGridSkeleton />;

    if (!data || data.data.length === 0) {
        return (
            <div className="text-center py-12">
                <p className="text-muted">You haven&apos;t signed up for any upcoming events yet.</p>
            </div>
        );
    }

    return (
        <div className={GRID_CLASS}>
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
