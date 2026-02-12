import { useState, useCallback } from 'react';

/**
 * Track "NEW" badge visibility via localStorage.
 * Absent key = new; markSeen writes a timestamp and hides the badge.
 */
export function useNewBadge(key: string): { isNew: boolean; markSeen: () => void } {
    const [isNew, setIsNew] = useState(() => localStorage.getItem(key) === null);

    const markSeen = useCallback(() => {
        if (isNew) {
            localStorage.setItem(key, Date.now().toString());
            setIsNew(false);
        }
    }, [key, isNew]);

    return { isNew, markSeen };
}
