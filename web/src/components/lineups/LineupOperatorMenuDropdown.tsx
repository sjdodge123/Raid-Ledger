/**
 * Presentational pieces of the lineup operator `⋮` menu (ROK-1323), split out
 * of LineupOperatorMenu to keep both files under the 300-line cap. Owns the
 * open-dropdown markup, the section headings/items, and the operator-only
 * public-share toggle line. Behaviour (state, modals, transitions) lives in
 * LineupOperatorMenu.
 */
import type { JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useTogglePublicShare } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';
import { LineupShareCopy } from './LineupShareCopy';
import type { AdjacentPhase } from './operator-menu-transitions';

export interface MenuModals {
  edit: boolean;
  abort: boolean;
  transitionTo: AdjacentPhase | null;
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

function PhaseItems({
  canAdvanceRevert,
  next,
  prev,
  onTransition,
}: {
  canAdvanceRevert: boolean;
  next: AdjacentPhase | null;
  prev: AdjacentPhase | null;
  onTransition: (p: AdjacentPhase) => void;
}): JSX.Element {
  return (
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
  );
}

export function OperatorMenuDropdown({
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
        <PhaseItems
          canAdvanceRevert={canAdvanceRevert}
          next={next}
          prev={prev}
          onTransition={onTransition}
        />
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
