import { useCallback } from 'react';
import { useSeenAdminSections } from './use-seen-admin-sections';

/**
 * Track "NEW" badge visibility via DB-persisted user preferences (ROK-285).
 * Replaces the previous localStorage implementation so badge state persists
 * across browsers and devices.
 *
 * Absent key = new; markSeen writes the key to the user's seen set in the DB.
 */
export function useNewBadge(key: string): { isNew: boolean; markSeen: () => void } {
  const { isNew: checkIsNew, markSeen: markSectionSeen } = useSeenAdminSections();

  const isNew = checkIsNew(key);

  const markSeen = useCallback(() => {
    if (key) {
      markSectionSeen(key);
    }
  }, [key, markSectionSeen]);

  return { isNew, markSeen };
}
