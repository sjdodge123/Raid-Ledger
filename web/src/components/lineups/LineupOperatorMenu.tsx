/**
 * LineupOperatorMenu (ROK-1323) — the `⋮` dropdown that collects the
 * operator/creator affordances stripped out of the legacy LineupDetailHeader.
 *
 * Visibility (preservation-risk #1): the trigger renders for an operator/admin
 * OR the lineup creator. Item-level gating:
 *   - Edit            → operator-or-creator
 *   - Advance / Revert → operator-only (idx±1; disabled at terminal/aborted)
 *   - Public-link toggle → operator-only
 *   - Copy link       → anyone, when share-enabled (also offered standalone for
 *                       members via LineupShareCopy)
 *   - Abort           → operator-only, non-archived
 *
 * Advance/Revert reuse useTransitionLineupStatus + the TIEBREAKER_REQUIRED
 * intercept so the tiebreaker prompt still opens (risk #5). Edit/Abort reuse
 * the existing EditLineupMetadataModal / AbortLineupModal.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { LineupDetailResponseDto, LineupStatusDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { useTransitionLineupStatus } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';
import { EditLineupMetadataModal } from './edit-lineup-metadata-modal';
import { AbortLineupModal } from './AbortLineupModal';
import { PhaseTransitionModal } from './phase-transition-modal';
import { nextPhase, prevPhase, type AdjacentPhase } from './operator-menu-transitions';
import { OperatorMenuDropdown, type MenuModals } from './LineupOperatorMenuDropdown';

interface Props {
  lineup: LineupDetailResponseDto;
  /** ROK-1207: aborted lineup is terminal — advance/revert disabled. */
  isAborted?: boolean;
  /** Reuse the page's tiebreaker prompt when advance hits TIEBREAKER_REQUIRED. */
  onTiebreakerIntercept?: () => void;
}

function useMenuOpenState(): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
} {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close]);
  return { isOpen, open: () => setIsOpen(true), close, containerRef };
}

/** Edit / Abort / phase-transition modal host, driven by the menu's state. */
function MenuModalsHost({
  lineup,
  modals,
  setModals,
  onTiebreakerIntercept,
}: {
  lineup: LineupDetailResponseDto;
  modals: MenuModals;
  setModals: React.Dispatch<React.SetStateAction<MenuModals>>;
  onTiebreakerIntercept?: () => void;
}): JSX.Element {
  const transition = useTransitionLineupStatus();
  const clearTransition = (): void =>
    setModals((m) => ({ ...m, transitionTo: null }));
  const runTransition = (target: AdjacentPhase): void => {
    transition.mutate(
      { lineupId: lineup.id, body: { status: target.status } },
      {
        onSuccess: () => {
          toast.success(`Moved to ${target.label}`);
          clearTransition();
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('TIEBREAKER_REQUIRED') && onTiebreakerIntercept) {
            onTiebreakerIntercept();
            clearTransition();
          } else {
            toast.error(msg || 'Transition failed');
          }
        },
      },
    );
  };
  return (
    <>
      {modals.edit && (
        <EditLineupMetadataModal
          lineupId={lineup.id}
          initialTitle={lineup.title}
          initialDescription={lineup.description}
          onClose={() => setModals((m) => ({ ...m, edit: false }))}
        />
      )}
      {modals.abort && (
        <AbortLineupModal
          lineupId={lineup.id}
          onClose={() => setModals((m) => ({ ...m, abort: false }))}
        />
      )}
      {modals.transitionTo && (
        <PhaseTransitionModal
          fromStatus={lineup.status as LineupStatusDto}
          toStatus={modals.transitionTo.status}
          isPending={transition.isPending}
          onCancel={clearTransition}
          onConfirm={() => modals.transitionTo && runTransition(modals.transitionTo)}
        />
      )}
    </>
  );
}

export function LineupOperatorMenu({
  lineup,
  isAborted = false,
  onTiebreakerIntercept,
}: Props): JSX.Element | null {
  const { user } = useAuth();
  const { isOpen, open, close, containerRef } = useMenuOpenState();
  const [modals, setModals] = useState<MenuModals>({
    edit: false,
    abort: false,
    transitionTo: null,
  });

  const isOperator = isOperatorOrAdmin(user);
  const isCreator = user != null && user.id === lineup.createdBy.id;
  // Edit follows the legacy useCanEdit rule (archived → no one edits).
  const canEdit = lineup.status !== 'archived' && (isOperator || isCreator);
  // The trigger shows for operator OR creator; without an editable action and
  // without operator powers there's nothing to show.
  if (!isOperator && !canEdit) return null;

  const canAdvanceRevert = !isAborted && lineup.status !== 'archived';
  const openModal = (patch: Partial<MenuModals>): void => {
    setModals((m) => ({ ...m, ...patch }));
    close();
  };

  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        type="button"
        data-testid="lineup-operator-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Lineup operator menu"
        onClick={() => (isOpen ? close() : open())}
        className="inline-flex items-center justify-center w-8 h-8 rounded text-muted hover:text-foreground hover:bg-overlay/50 transition-colors"
      >
        <span aria-hidden="true" className="text-lg leading-none">⋮</span>
      </button>
      {isOpen && (
        <OperatorMenuDropdown
          lineup={lineup}
          isOperator={isOperator}
          canAdvanceRevert={canAdvanceRevert}
          next={nextPhase(lineup.status as LineupStatusDto)}
          prev={prevPhase(lineup.status as LineupStatusDto)}
          onEdit={() => openModal({ edit: true })}
          onAbort={() => openModal({ abort: true })}
          onTransition={(p) => openModal({ transitionTo: p })}
          onClose={close}
        />
      )}
      <MenuModalsHost
        lineup={lineup}
        modals={modals}
        setModals={setModals}
        onTiebreakerIntercept={onTiebreakerIntercept}
      />
    </div>
  );
}
