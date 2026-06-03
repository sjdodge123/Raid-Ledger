/**
 * Sticky-toolbar auto-hide hook for the ROK-1300 Scheduling composite.
 *
 * Verbatim mechanism from `VotingComposite.tsx:202-215` / `NominatingComposite`:
 * a 1px sentinel above the sticky wrapper flips `hasPinned` true once it
 * scrolls off-screen (IntersectionObserver); after that the toolbar rides the
 * Header's `useScrollDirection` signal — hiding on mobile scroll-down,
 * reappearing on scroll-up. Desktop pins via `md:translate-y-0`.
 */
import { useEffect, useRef, useState } from 'react';
import { useScrollDirection } from '../../../hooks/use-scroll-direction';

export interface SchedulingSticky {
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  /** True once pinned AND scrolling down — wrapper translates off-screen. */
  isHidden: boolean;
}

/** Drive the sticky toolbar's pin + auto-hide state. */
export function useSchedulingSticky(): SchedulingSticky {
  const scrollDir = useScrollDirection();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [hasPinned, setHasPinned] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHasPinned(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  return { sentinelRef, isHidden: scrollDir === 'down' && hasPinned };
}
