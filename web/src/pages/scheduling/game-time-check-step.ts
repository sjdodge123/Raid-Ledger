/**
 * The step-1 "I'm done" seam for `GameTimeCheckSheet` (ROK-1574).
 *
 * Step 1 is a slot the composite fills — today `GameTimeCheckBody`, next
 * ROK-1569's phone week editor. Whatever sits there needs one thing from the
 * shell: a way to say "this step is finished, move to the ballot". A context
 * keeps the slot a plain `ReactNode` instead of a render prop, so the shell
 * never has to know what it rendered.
 */
import { createContext, useContext } from 'react';

/** No-op outside the sheet — a step-1 body also renders in the desktop modal. */
export const StepOneDoneContext = createContext<() => void>(() => {});

/** Call the returned function to advance the sheet from step 1 to step 2. */
export function useStepOneDone(): () => void {
    return useContext(StepOneDoneContext);
}
