/**
 * ROK-2033 — admin "Reopen lock-in" for a poll whose lock-in claimed the match
 * but never created an event. A §4.7 `warning` status banner at the top of the
 * poll body (not a Manage-menu row: a `locked_in` poll is read-only, and
 * `SchedulingCancelAction` / the Manage shells hide themselves then).
 *
 * Renders only when the server set `lockInRecoverable` (admin-only already);
 * `isAdmin` is defence in depth. The confirm is the §4.4 split — `Modal` at
 * ≥1024px, `BottomSheet` below — and cannot be closed mid-request.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { useAuth, isAdmin } from '../../../hooks/use-auth';
import { useReopenLockIn } from '../../../hooks/use-scheduling';

export const REOPEN_BANNER_COPY =
  "This lock-in didn't finish — no event was created.";
export const REOPEN_CONFIRM_COPY =
  'Reopen this poll for voting? Any half-created event from the failed lock-in is removed, and the poll can be locked in again.';

export interface SchedulingReopenLockInActionProps {
  matchId: number;
  /** `SchedulePollPageResponseDto.lockInRecoverable` — set only for admins. */
  recoverable: boolean | undefined;
}

/**
 * Gate first, hooks after: a poll without the flag (every poll but a stalled
 * lock-in) mounts nothing and calls no hook, so the composite's many test
 * doubles of `use-scheduling` / `use-auth` need no new entries.
 */
export function SchedulingReopenLockInAction(
  props: SchedulingReopenLockInActionProps,
): JSX.Element | null {
  if (props.recoverable !== true) return null;
  return <AdminGate matchId={props.matchId} />;
}

function AdminGate({ matchId }: { matchId: number }): JSX.Element | null {
  const { user } = useAuth();
  if (!isAdmin(user)) return null;
  return <ReopenBanner matchId={matchId} />;
}

function ReopenBanner({ matchId }: { matchId: number }): JSX.Element {
  const reopen = useReopenLockIn();
  const [isOpen, setIsOpen] = useState(false);
  const pending = reopen.isPending;
  const close = (): void => { if (!pending) setIsOpen(false); };
  const confirm = (): void => {
    reopen.mutate(
      { matchId },
      { onSettled: () => setIsOpen(false) },
    );
  };
  return (
    <div
      role="status"
      data-testid="scheduling-reopen-lock-in"
      className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm font-medium text-warning">{REOPEN_BANNER_COPY}</p>
      <Button variant="warning-soft" size="sm" onClick={() => setIsOpen(true)}>
        Reopen lock-in
      </Button>
      <ReopenConfirm isOpen={isOpen} onClose={close} onConfirm={confirm} pending={pending} />
    </div>
  );
}

function ReopenConfirm({ isOpen, onClose, onConfirm, pending }: {
  isOpen: boolean; onClose: () => void; onConfirm: () => void; pending: boolean;
}): JSX.Element | null {
  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <Button variant="primary" onClick={onConfirm} loading={pending} loadingLabel="Reopening…">
        Reopen poll
      </Button>
    </div>
  );
  return (
    <ConfirmShell isOpen={isOpen} onClose={onClose} title="Reopen lock-in?" footer={footer}>
      <p className="text-sm text-foreground">{REOPEN_CONFIRM_COPY}</p>
    </ConfirmShell>
  );
}

/** Closed → nothing mounted (a closed `BottomSheet` only slides off-screen). */
function ConfirmShell(props: {
  isOpen: boolean; onClose: () => void; title: string; footer: ReactNode; children: ReactNode;
}): JSX.Element | null {
  const Shell = useMediaQuery(DESKTOP_MQ) ? Modal : BottomSheet;
  if (!props.isOpen) return null;
  return <Shell {...props} />;
}
