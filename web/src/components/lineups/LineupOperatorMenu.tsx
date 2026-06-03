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
import { useTransitionLineupStatus, useTogglePublicShare } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';
import { EditLineupMetadataModal } from './edit-lineup-metadata-modal';
import { AbortLineupModal } from './AbortLineupModal';
import { PhaseTransitionModal } from './phase-transition-modal';
import { LineupShareCopy } from './LineupShareCopy';
import { nextPhase, prevPhase, type AdjacentPhase } from './operator-menu-transitions';

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

function MenuHeading({ children }: { children: string }): JSX.Element {
  return (
    <div className="px-3 pt-2 pb-1 text-[9.5px] uppercase tracking-wider text-dim">
      {children}
    </div>
  );
}

function MenuItem({
  onClick,
  testId,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const tone = danger
    ? 'text-rose-300 hover:text-rose-200'
    : 'text-secondary hover:text-foreground';
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${tone} hover:bg-panel transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

/** Operator-only public-share toggle line. Mirrors the legacy PublicShareRow. */
function ShareToggleItem({
  lineup,
}: {
  lineup: LineupDetailResponseDto;
}): JSX.Element {
  const toggle = useTogglePublicShare();
  const enabled = lineup.publicShareEnabled;
  const onToggle = (): void => {
    toggle.mutate(
      { lineupId: lineup.id, enabled: !enabled },
      {
        onSuccess: () =>
          toast.success(enabled ? 'Public link disabled' : 'Public link enabled'),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Toggle failed'),
      },
    );
  };
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onToggle}
      disabled={toggle.isPending}
      aria-pressed={enabled}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-secondary hover:bg-panel hover:text-foreground transition-colors disabled:opacity-50"
    >
      <span>Public link</span>
      <span className={enabled ? 'text-emerald-300 text-xs' : 'text-dim text-xs'}>
        {enabled ? 'On' : 'Off'}
      </span>
    </button>
  );
}

interface MenuModals {
  edit: boolean;
  abort: boolean;
  transitionTo: AdjacentPhase | null;
}

function OperatorMenuDropdown({
  lineup,
  isOperator,
  canAdvanceRevert,
  next,
  prev,
  onEdit,
  onAbort,
  onTransition,
  onClose,
}: {
  lineup: LineupDetailResponseDto;
  isOperator: boolean;
  canAdvanceRevert: boolean;
  next: AdjacentPhase | null;
  prev: AdjacentPhase | null;
  onEdit: () => void;
  onAbort: () => void;
  onTransition: (p: AdjacentPhase) => void;
  onClose: () => void;
}): JSX.Element {
  const showSharing = lineup.visibility !== 'private' && isOperator;
  const showAbort = isOperator && lineup.status !== 'archived';
  return (
    <div
      role="menu"
      data-testid="lineup-operator-menu"
      className="absolute right-0 mt-1 w-56 bg-surface border border-edge rounded-lg shadow-xl z-50 py-1"
    >
      <MenuHeading>Operator</MenuHeading>
      <MenuItem testId="lineup-operator-menu-edit" onClick={onEdit}>
        Edit lineup
      </MenuItem>
      {isOperator && (
        <>
          <MenuItem
            testId="lineup-operator-menu-advance"
            onClick={() => next && onTransition(next)}
            disabled={!canAdvanceRevert || next == null}
          >
            {next ? `Advance to ${next.label}` : 'Advance'}
          </MenuItem>
          <MenuItem
            testId="lineup-operator-menu-revert"
            onClick={() => prev && onTransition(prev)}
            disabled={!canAdvanceRevert || prev == null}
          >
            {prev ? `Revert to ${prev.label}` : 'Revert'}
          </MenuItem>
        </>
      )}
      {showSharing && (
        <>
          <MenuHeading>Sharing</MenuHeading>
          <ShareToggleItem lineup={lineup} />
          {lineup.publicShareEnabled && (
            <LineupShareCopy slug={lineup.publicSlug} variant="item" onCopied={onClose} />
          )}
        </>
      )}
      {showAbort && (
        <>
          <MenuHeading>Danger</MenuHeading>
          <MenuItem testId="lineup-operator-menu-abort" onClick={onAbort} danger>
            Abort lineup
          </MenuItem>
        </>
      )}
    </div>
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
  const transition = useTransitionLineupStatus();

  const isOperator = isOperatorOrAdmin(user);
  const isCreator = user != null && user.id === lineup.createdBy.id;
  // Edit follows the legacy useCanEdit rule (archived → no one edits).
  const canEdit = lineup.status !== 'archived' && (isOperator || isCreator);
  // The trigger shows for operator OR creator; without an editable action and
  // without operator powers there's nothing to show.
  if (!isOperator && !canEdit) return null;

  const next = nextPhase(lineup.status as LineupStatusDto);
  const prev = prevPhase(lineup.status as LineupStatusDto);
  const canAdvanceRevert = !isAborted && lineup.status !== 'archived';

  const runTransition = (target: AdjacentPhase): void => {
    transition.mutate(
      { lineupId: lineup.id, body: { status: target.status } },
      {
        onSuccess: () => {
          toast.success(`Moved to ${target.label}`);
          setModals((m) => ({ ...m, transitionTo: null }));
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('TIEBREAKER_REQUIRED') && onTiebreakerIntercept) {
            onTiebreakerIntercept();
            setModals((m) => ({ ...m, transitionTo: null }));
          } else {
            toast.error(msg || 'Transition failed');
          }
        },
      },
    );
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
          next={next}
          prev={prev}
          onEdit={() => {
            setModals((m) => ({ ...m, edit: true }));
            close();
          }}
          onAbort={() => {
            setModals((m) => ({ ...m, abort: true }));
            close();
          }}
          onTransition={(p) => {
            setModals((m) => ({ ...m, transitionTo: p }));
            close();
          }}
          onClose={close}
        />
      )}
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
          onCancel={() => setModals((m) => ({ ...m, transitionTo: null }))}
          onConfirm={() => modals.transitionTo && runTransition(modals.transitionTo)}
        />
      )}
    </div>
  );
}
