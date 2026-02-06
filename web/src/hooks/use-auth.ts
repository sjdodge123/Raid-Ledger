import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/config';

const TOKEN_KEY = 'raid_ledger_token';

export interface User {
    id: number;
    discordId: string;
    username: string;
    avatar: string | null;
    isAdmin?: boolean;
}

/**
 * Get stored auth token
 */
export function getAuthToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Fetch current authenticated user from /auth/me
 */
async function fetchCurrentUser(): Promise<User | null> {
    const token = getAuthToken();

    if (!token) {
        return null;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            // 401 means token is invalid/expired - clear it
            if (response.status === 401) {
                localStorage.removeItem(TOKEN_KEY);
                // Note: Don't show toast here - this runs on every page load
                // Session expiry feedback is handled by ProtectedRoute redirecting to login
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
    const queryClient = useQueryClient();

    const { data: user, isLoading, error, refetch } = useQuery({
        queryKey: ['auth', 'me'],
        queryFn: fetchCurrentUser,
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: false, // Don't retry auth failures
    });

    const login = async (token: string): Promise<boolean> => {
        localStorage.setItem(TOKEN_KEY, token);
        try {
            // Refetch user data - invalidateQueries triggers refetch automatically
            await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
            return true;
        } catch (error) {
            // If refetch fails, token is already stored so user will be fetched on next page load
            console.error('Failed to fetch user after login:', error);
            return false;
        }
    };

    const logout = () => {
        localStorage.removeItem(TOKEN_KEY);
        queryClient.setQueryData(['auth', 'me'], null);
    };

    return {
        user: user ?? null,
        isLoading,
        isAuthenticated: !!user,
        error,
        refetch,
        login,
        logout,
    };
}
