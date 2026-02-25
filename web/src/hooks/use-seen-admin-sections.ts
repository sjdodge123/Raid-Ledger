import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMyPreferences, updatePreference } from '../lib/api-client';
import { useAuth, isAdmin } from './use-auth';

const PREF_KEY = 'seen_admin_sections';

/**
 * DB-backed "seen" state for admin sidebar sections (ROK-285).
 * Stores an array of section keys the admin has visited in the user_preferences table.
 * Only fetches for admin users.
 */
export function useSeenAdminSections() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdminUser = isAdmin(user);

  const { data: seenKeys = [], isLoading } = useQuery({
    queryKey: ['preferences', PREF_KEY],
    queryFn: async () => {
      const prefs = await getMyPreferences();
      const value = prefs[PREF_KEY];
      if (Array.isArray(value)) return value as string[];
      return [];
    },
    enabled: isAdminUser,
    staleTime: 1000 * 60 * 5,
  });

  const mutation = useMutation({
    mutationFn: async (key: string) => {
      const current = queryClient.getQueryData<string[]>(['preferences', PREF_KEY]) ?? [];
      if (current.includes(key)) return;
      const updated = [...current, key];
      await updatePreference(PREF_KEY, updated);
    },
    onMutate: async (key: string) => {
      await queryClient.cancelQueries({ queryKey: ['preferences', PREF_KEY] });
      const previous = queryClient.getQueryData<string[]>(['preferences', PREF_KEY]) ?? [];
      if (!previous.includes(key)) {
        queryClient.setQueryData(['preferences', PREF_KEY], [...previous, key]);
      }
      return { previous };
    },
    onError: (_err, _key, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['preferences', PREF_KEY], context.previous);
      }
    },
    onSettled: () => {
      // Refetch from server to ensure cache matches DB state
      queryClient.invalidateQueries({ queryKey: ['preferences', PREF_KEY] });
    },
  });

  const markSeen = useCallback(
    (key: string) => {
      if (!key || seenKeys.includes(key)) return;
      mutation.mutate(key);
    },
    [seenKeys, mutation],
  );

  const isNew = useCallback(
    (key: string) => {
      if (!key || !isAdminUser || isLoading) return false;
      return !seenKeys.includes(key);
    },
    [seenKeys, isAdminUser, isLoading],
  );

  return { seenKeys, isNew, markSeen, isLoading };
}
