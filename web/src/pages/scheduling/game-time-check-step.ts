/**
 * The "I'm done" seam for `GameTimeCheckSheet` (ROK-1574 → ROK-1579).
 *
 * The sheet's body is a slot the composite fills — today ROK-1569's phone week
 * editor. Whatever sits there needs one thing from the shell: a way to say
 * "the check is answered". A context keeps the slot a plain `ReactNode`
 * instead of a render prop, so the shell never has to know what it rendered.
 *
 * ROK-1579 removed the sheet's second step, so reporting done now COLLAPSES the
 * drawer (the same path as its close button) rather than advancing a stepper.
 */
import { createContext, useContext } from 'react';

/** No-op outside the sheet — the same body also renders in the desktop modal. */
export const StepOneDoneContext = createContext<() => void>(() => {});

/** Call the returned function to report the check answered — the sheet collapses. */
export function useStepOneDone(): () => void {
    return useContext(StepOneDoneContext);
}
