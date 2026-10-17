import { useQuery } from '@tanstack/react-query';
import { getMyDashboard, getEvents } from '../lib/api-client';

/**
 * Hook to fetch the organizer dashboard (ROK-213).
 * Returns enriched events with fill rates, missing roles, and aggregate stats.
 */
export function useMyDashboard() {
    return useQuery({
        queryKey: ['events', 'my-dashboard'],
        queryFn: () => getMyDashboard(),
    });
}

/**
 * Hook to fetch events the current user has signed up for (ROK-213).
 */
export function useMySignedUpEvents() {
    return useQuery({
        queryKey: ['events', { signedUpAs: 'me', upcoming: true }],
        queryFn: () => getEvents({ signedUpAs: 'me', upcoming: true }),
    });
}
