import { useCallback, useEffect, useRef } from 'react';
import { useSeenAdminSections } from './use-seen-admin-sections';

/**
 * Track "NEW" badge visibility via DB-persisted user preferences (ROK-285).
 * Replaces the previous localStorage implementation so badge state persists
 * across browsers and devices.
 *
 * Absent key = new; markSeen writes the key to the user's seen set in the DB.
 * When `isActive` is true (user is on the page), automatically marks as seen.
 */
export function useNewBadge(key: string, isActive = false): { isNew: boolean; markSeen: () => void } {
  const { isNew: checkIsNew, markSeen: markSectionSeen } = useSeenAdminSections();

  const isNew = checkIsNew(key);

  const markSeen = useCallback(() => {
    if (key) {
      markSectionSeen(key);
    }
  }, [key, markSectionSeen]);

  // Auto-dismiss when the user navigates to the page (isActive becomes true)
  const hasMarked = useRef(false);
  useEffect(() => {
    if (isActive && isNew && !hasMarked.current) {
      hasMarked.current = true;
      markSeen();
    }
    if (!isActive) {
      hasMarked.current = false;
    }
  }, [isActive, isNew, markSeen]);

  return { isNew, markSeen };
}
