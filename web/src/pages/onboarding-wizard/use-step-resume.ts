/**
 * ROK-2022: `?resume=calendar` — the Google OAuth callback re-opens the
 * first-run wizard on its Calendar step. The wizard keeps its position in
 * plain state, so a page load restarts at step 0; this seeks once the step
 * list has settled, then strips `resume` (the step strips `connected`/`error`).
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StepDef } from './onboarding-types';

export const RESUME_PARAM = 'resume';
export const RESUME_CALENDAR = 'calendar';

/**
 * Whether this mount is an OAuth return. Read once: the seek strips the param,
 * and the rerun allowance + the step-flag latch must outlive that.
 */
export function useResumeCalendar(): boolean {
    const [params] = useSearchParams();
    const [resume] = useState(() => params.get(RESUME_PARAM) === RESUME_CALENDAR);
    return resume;
}

/**
 * One-shot seek to the Calendar step once `settled` (the caller waits for the character steps
 * too, so the index is final). A missing step (switch off, overview error) strips `connected` /
 * `error` as well: no step is there to.
 */
export function useStepResume(
    resume: boolean, settled: boolean, steps: StepDef[], setCurrentStep: (n: number) => void,
): void {
    const [, setParams] = useSearchParams();
    const done = useRef(false);
    useEffect(() => {
        if (!resume || !settled || done.current) return;
        done.current = true;
        const index = steps.findIndex((s) => s.key === RESUME_CALENDAR);
        if (index >= 0) setCurrentStep(index);
        setParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete(RESUME_PARAM);
            if (index < 0) { next.delete('connected'); next.delete('error'); }
            return next;
        }, { replace: true });
    }, [resume, settled, steps, setCurrentStep, setParams]);
}
