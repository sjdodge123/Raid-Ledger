/**
 * Visually-hidden polite live region for the scheduling poll (ROK-1546 AC2).
 *
 * Renders nothing visible — the sighted user already sees the vote mark move
 * and the leader card change. Its only job is to give assistive tech a text
 * node that CHANGES when those things happen. Message content and timing are
 * owned by `useSchedulingAnnouncer`.
 */
import type { JSX } from 'react';

/** Props for {@link SchedulingAnnouncer}. */
export interface SchedulingAnnouncerProps {
  /** Text to announce; `''` renders an empty (silent) region. */
  message: string;
}

/** Polite scheduling-poll live region — see file-level docstring. */
export function SchedulingAnnouncer(
  props: SchedulingAnnouncerProps,
): JSX.Element {
  return (
    <div
      data-testid="scheduling-announcer"
      role="status"
      aria-live="polite"
      className="sr-only"
    >
      {props.message}
    </div>
  );
}
