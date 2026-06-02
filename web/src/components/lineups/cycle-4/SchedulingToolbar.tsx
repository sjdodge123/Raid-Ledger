/**
 * Sticky JourneyHero toolbar for the ROK-1300 Scheduling composite.
 *
 * The submit ritual lives HERE — inside the sticky, scroll-aware toolbar —
 * NOT in a bottom `<SubmitBar>` (matches shipped Sv/S1; see the dev brief's
 * divergence note). The sentinel + auto-hide transform are owned by
 * `useSchedulingSticky`; this component renders the hero + action row.
 */
import type { JSX } from 'react';
import { JourneyHero } from '../../shared/journey-hero';
import type { JourneyHeroProps } from '../../shared/journey-hero/types';
import { StickyHeroScheduleSubmitButton } from './sticky-hero-buttons';
import { useSchedulingSticky } from './use-scheduling-sticky';

export interface SchedulingToolbarProps {
  hero: JourneyHeroProps;
  submitLabel: string;
  submitted: boolean;
  submitDisabled: boolean;
  submitDisabledReason?: string;
  nudge?: string;
  onSubmit: () => void;
}

/** Sticky toolbar hero + submit affordance — see file-level docstring. */
export function SchedulingToolbar(props: SchedulingToolbarProps): JSX.Element {
  const { hero } = props;
  const { sentinelRef, isHidden } = useSchedulingSticky();
  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div
        className={`sticky top-14 z-20 py-3 bg-backdrop md:bg-surface md:rounded-md md:px-3 will-change-transform md:will-change-auto md:translate-y-0 ${
          isHidden
            ? '-translate-y-[calc(100%+3.5rem)]'
            : 'translate-y-0'
        }`}
        style={{ transition: 'transform 300ms ease-in-out' }}
      >
        <JourneyHero {...hero} />
        <div className="flex items-center gap-2 mt-2 px-1">
          <div className="ml-auto flex-shrink-0">
            <StickyHeroScheduleSubmitButton
              label={props.submitLabel}
              submitted={props.submitted}
              disabled={props.submitDisabled}
              disabledReason={props.submitDisabledReason}
              onClick={props.onSubmit}
            />
          </div>
        </div>
        {props.nudge && (
          <p className="mt-1 px-1 text-[11px] text-muted italic">
            {props.nudge}
          </p>
        )}
      </div>
    </>
  );
}
