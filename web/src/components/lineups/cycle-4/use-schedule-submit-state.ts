/**
 * Submit-state hook for the ROK-1300 Scheduling composite.
 *
 * Owns the dirty-unlock pattern copied from `VotingComposite` (lines 140-192):
 * the server-stamped `schedulingSubmittedAt` is the source of truth, but a
 * local `dirty` flag re-arms the toolbar submit when the viewer clicks
 * "Change my times" (explicit unlock) or toggles a vote after submitting
 * (implicit unlock). A fresh `submittedAt` from the server clears `dirty`.
 */
import { useState } from 'react';
import {
  deriveScheduleSubmitKind,
} from './scheduling-submit-copy';
import type { SubmitKind } from '../../shared/submit-bar/derive-kind';

export interface ScheduleSubmitState {
  /** Effective submitted (server-stamped AND not locally dirty). */
  submitted: boolean;
  /** SubmitBar visual kind for the toolbar button. */
  kind: SubmitKind;
  /** Server has a stamp (regardless of dirty). */
  serverSubmitted: boolean;
  /** Explicit unlock — call from "Change my times". */
  unlock: () => void;
  /** Implicit unlock — call when a vote is toggled post-submit. */
  markDirty: () => void;
}

/** Derive the composite's submit state from server + local dirty flag. */
export function useScheduleSubmitState(
  submittedAt: string | null,
  myVotedSlotIds: number[],
): ScheduleSubmitState {
  const serverSubmitted = submittedAt != null;
  const [dirty, setDirty] = useState(false);
  const [prevSubmittedAt, setPrevSubmittedAt] = useState(submittedAt);
  if (submittedAt !== prevSubmittedAt) {
    setPrevSubmittedAt(submittedAt);
    if (serverSubmitted) setDirty(false);
  }
  const submitted = serverSubmitted && !dirty;
  const kind = deriveScheduleSubmitKind({
    submittedAt: submitted ? submittedAt : null,
    myVotedSlotIds,
  });
  return {
    submitted,
    kind,
    serverSubmitted,
    unlock: () => setDirty(true),
    markDirty: () => {
      if (serverSubmitted) setDirty(true);
    },
  };
}
