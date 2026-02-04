import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';

export interface User {
    id: number;
    discordId: string;
    username: string;
    avatar: string | null;
}

/**
 * Fetch current authenticated user from /auth/me
 */
async function fetchCurrentUser(): Promise<User | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            credentials: 'include',
        });

        if (!response.ok) {
            // 401 means not authenticated - this is not an error
            if (response.status === 401) {
                return null;
            }
            throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
    } catch {
        return null;
    }
}

/**
 * Hook to get the current authenticated user
 * Returns null when not authenticated
 */
export function useAuth() {
    const { data: user, isLoading, error, refetch } = useQuery({
        queryKey: ['auth', 'me'],
        queryFn: fetchCurrentUser,
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: false, // Don't retry auth failures
    });

    return {
        user: user ?? null,
        isLoading,
        isAuthenticated: !!user,
        error,
        refetch,
    };
}
