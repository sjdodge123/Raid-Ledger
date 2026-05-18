/**
 * Slide-out drawer for the viewer's already-nominated games (ROK-1297
 * round 5h). Replaces the "scroll the whole page to the bottom" flow
 * when the operator taps the "Nominations · N" button in the sticky
 * JourneyHero. Mobile renders as a bottom-sheet; desktop as a right-
 * side drawer. Chrome mirrors `GameResearchDrawer` (U2) so the two
 * drawers feel like the same primitive.
 */
import { useEffect, useRef, type JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { useFocusTrap } from '../../../hooks/use-focus-trap';
import { useRemoveNomination } from '../../../hooks/use-lineups';
import { NominationCard } from '../NominationCard';

export interface MyNominationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  entries: readonly LineupEntryResponseDto[];
  lineupId: number;
}

function useEscToClose(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);
}

function useInitialFocus(
  isOpen: boolean,
  dialogRef: React.RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const node = dialogRef.current;
    if (!node) return;
    const id = requestAnimationFrame(() => {
      const closeBtn = node.querySelector<HTMLElement>(
        '[data-testid="my-nominations-drawer-close"]',
      );
      if (closeBtn) closeBtn.focus();
      else node.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, dialogRef]);
}

function DrawerHeader({
  count,
  onClose,
}: {
  count: number;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-edge-subtle">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          Your nominations
        </h2>
        <p className="text-xs text-muted">
          {count === 0
            ? 'No nominations yet'
            : `${count} game${count === 1 ? '' : 's'} on the running list`}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        data-testid="my-nominations-drawer-close"
        aria-label="Close nominations drawer"
        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-overlay/40 transition-colors"
      >
        <svg
          aria-hidden="true"
          className="w-5 h-5 stroke-current"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}

function DrawerBody({
  entries,
  lineupId,
}: {
  entries: readonly LineupEntryResponseDto[];
  lineupId: number;
}): JSX.Element {
  const removeMutation = useRemoveNomination();
  const handleRemove = (gameId: number): void => {
    removeMutation.mutate({ lineupId, gameId });
  };
  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted">
        You haven&apos;t nominated any games yet.
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3">
      {entries.map((entry) => (
        <NominationCard
          key={entry.id}
          entry={entry}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

export function MyNominationsDrawer(
  props: MyNominationsDrawerProps,
): JSX.Element | null {
  const { isOpen, onClose, entries, lineupId } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
  useEscToClose(isOpen, onClose);
  useInitialFocus(isOpen, dialogRef);
  if (!isOpen) return null;
  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50"
      data-testid="my-nominations-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Your nominations"
      tabIndex={-1}
    >
      <div
        data-testid="my-nominations-drawer-backdrop"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={trapRef}
        data-testid="my-nominations-drawer-panel"
        className="absolute bg-surface flex flex-col overflow-hidden inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl md:inset-y-0 md:right-0 md:left-auto md:w-[480px] md:max-h-none md:rounded-none md:border-l md:border-edge-subtle"
      >
        <DrawerHeader count={entries.length} onClose={onClose} />
        <div className="flex-1 overflow-y-auto">
          <DrawerBody entries={entries} lineupId={lineupId} />
        </div>
      </div>
    </div>
  );
}
