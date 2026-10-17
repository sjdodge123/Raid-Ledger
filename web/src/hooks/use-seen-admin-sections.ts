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
const SEEN_QUERY_KEY = ['preferences', PREF_KEY];

function useSeenKeysQuery(isAdminUser: boolean) {
  return useQuery({
    queryKey: SEEN_QUERY_KEY,
    queryFn: async () => {
      const prefs = await getMyPreferences();
      const value = prefs[PREF_KEY];
      return Array.isArray(value) ? (value as string[]) : [];
    },
    enabled: isAdminUser,
    staleTime: 1000 * 60 * 5,
  });
}

function useMarkSeenMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const updated = queryClient.getQueryData<string[]>(SEEN_QUERY_KEY) ?? [key];
      await updatePreference(PREF_KEY, updated);
    },
    onMutate: async (key: string) => {
      await queryClient.cancelQueries({ queryKey: SEEN_QUERY_KEY });
      const previous = queryClient.getQueryData<string[]>(SEEN_QUERY_KEY) ?? [];
      if (!previous.includes(key)) queryClient.setQueryData(SEEN_QUERY_KEY, [...previous, key]);
      return { previous };
    },
    onError: (_err, _key, context) => {
      if (context?.previous) queryClient.setQueryData(SEEN_QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SEEN_QUERY_KEY }),
  });
}

export function useSeenAdminSections() {
  const { user } = useAuth();
  const isAdminUser = isAdmin(user);
  const { data: seenKeys = [], isLoading } = useSeenKeysQuery(isAdminUser);
  const mutation = useMarkSeenMutation();

  const markSeen = useCallback(
    (key: string) => { if (key && !seenKeys.includes(key)) mutation.mutate(key); },
    [seenKeys, mutation],
  );

  const isNew = useCallback(
    (key: string) => !!(key && isAdminUser && !isLoading && !seenKeys.includes(key)),
    [seenKeys, isAdminUser, isLoading],
  );

  return { seenKeys, isNew, markSeen, isLoading };
}
