import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { EventsTab } from '../../components/events/events-mobile-toolbar';

interface EventsPageHeaderProps {
    activeTab: EventsTab;
    filteredGameName: string | null;
    isAuthenticated: boolean;
}

/** Page header with title, subtitle, and create/plan buttons */
export function EventsPageHeader({ activeTab, filteredGameName, isAuthenticated }: EventsPageHeaderProps): JSX.Element {
    return (
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
                <h1 className="text-3xl font-bold text-foreground mb-2">
                    {filteredGameName
                        ? `${filteredGameName} Events`
                        : activeTab === 'plans'
                            ? 'Event Plans'
                            : activeTab === 'past'
                                ? 'Past Events'
                                : activeTab === 'mine'
                                    ? 'My Events'
                                    : 'Upcoming Events'}
                </h1>
                <p className="text-muted">
                    {filteredGameName
                        ? `Showing events for ${filteredGameName}`
                        : activeTab === 'plans'
                            ? 'Community event planning polls'
                            : activeTab === 'past'
                                ? 'Browse completed gaming sessions'
                                : activeTab === 'mine'
                                    ? 'Events you\'ve signed up for'
                                    : 'Discover and sign up for gaming sessions'}
                </p>
            </div>
            {isAuthenticated && <CreateEventButtons />}
        </div>
    );
}

/** Plan Event + Create Event action buttons */
function CreateEventButtons(): JSX.Element {
    return (
        <div className="flex items-center gap-3">
            <Link
                to="/events/plan"
                className="inline-flex items-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-500 text-foreground font-semibold rounded-lg transition-colors shadow-lg shadow-violet-600/25"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Plan Event
            </Link>
            <Link
                to="/events/new"
                className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors shadow-lg shadow-emerald-600/25"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create Event
            </Link>
        </div>
    );
}
