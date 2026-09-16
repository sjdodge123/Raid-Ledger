/**
 * The lineup operator `⋮` menu, sheet-shaped (ROK-1584, approved design §4).
 *
 * On a phone a 224px popover anchored to a 32px glyph in the page header is a
 * bad target; below the phone breakpoint `LineupOperatorMenu` opens THIS
 * bottom sheet instead of `OperatorMenuDropdown`. Same items, same gates, same
 * handlers, same testids — only the presentation differs, so the desktop
 * dropdown and every existing spec are untouched.
 */
import type { JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { BottomSheet } from '../ui/bottom-sheet';
import { SheetTitleRow } from '../../pages/scheduling/SheetTitleRow';
import { LineupShareCopy } from './LineupShareCopy';
import { ShareToggleItem } from './LineupOperatorMenuDropdown';
import type { AdjacentPhase } from './operator-menu-transitions';

const ROW =
  'flex w-full min-h-[52px] items-center justify-between gap-3 rounded-lg ' +
  'px-3 py-2 text-left text-sm font-medium transition-colors ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

/** One 52px row of the sheet — mirrors `MenuItem` in the desktop dropdown. */
function SheetItem({
  title,
  subline,
  onClick,
  disabled,
  danger,
  testId,
}: {
  title: string;
  subline?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}): JSX.Element {
  const tone = danger
    ? 'text-rose-300 hover:bg-red-500/20'
    : 'text-secondary hover:bg-panel hover:text-foreground';
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      className={`${ROW} ${tone}`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{title}</span>
        {subline && (
          <span className="truncate text-xs font-normal text-dim">{subline}</span>
        )}
      </span>
    </button>
  );
}

/** Advance / Revert rows — operator-only, disabled at the terminal phases. */
function PhaseRows({
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
      <SheetItem
        testId="lineup-operator-menu-advance"
        title={next ? `Advance to ${next.label}` : 'Advance'}
        onClick={() => next && onTransition(next)}
        disabled={!canAdvanceRevert || next == null}
      />
      <SheetItem
        testId="lineup-operator-menu-revert"
        title={prev ? `Revert to ${prev.label}` : 'Revert'}
        onClick={() => prev && onTransition(prev)}
        disabled={!canAdvanceRevert || prev == null}
      />
    </>
  );
}

/** Public-link toggle + copy — the dropdown's Sharing section, sheet-shaped. */
function SharingRows({
  lineup,
  onClose,
}: {
  lineup: LineupDetailResponseDto;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      <ShareToggleItem lineup={lineup} />
      {lineup.publicShareEnabled && (
        <LineupShareCopy
          slug={lineup.publicSlug}
          variant="item"
          onCopied={onClose}
        />
      )}
    </>
  );
}

export interface LineupOperatorMenuSheetProps {
  lineup: LineupDetailResponseDto;
  isOperator: boolean;
  canEdit: boolean;
  canAdvanceRevert: boolean;
  next: AdjacentPhase | null;
  prev: AdjacentPhase | null;
  onEdit: () => void;
  onAbort: () => void;
  onTransition: (p: AdjacentPhase) => void;
  onClose: () => void;
}

/** Phone presentation of the operator ⋮ menu — see file-level docstring. */
export function OperatorMenuSheet(
  props: LineupOperatorMenuSheetProps,
): JSX.Element {
  const { lineup, isOperator, canEdit, onEdit, onAbort, onClose } = props;
  const showSharing = lineup.visibility !== 'private' && isOperator;
  const showAbort = isOperator && lineup.status !== 'archived';
  return (
    <BottomSheet isOpen onClose={onClose} ariaLabel="Lineup menu">
      <div
        role="menu"
        data-testid="lineup-operator-menu"
        className="flex flex-col gap-1 pb-2"
      >
        <SheetTitleRow
          title={lineup.title}
          onClose={onClose}
          testId="lineup-operator-menu-title"
        />
        {canEdit && (
          <SheetItem
            testId="lineup-operator-menu-edit"
            title="Edit lineup"
            subline="title, deadlines, privacy"
            onClick={onEdit}
          />
        )}
        {isOperator && (
          <PhaseRows
            canAdvanceRevert={props.canAdvanceRevert}
            next={props.next}
            prev={props.prev}
            onTransition={props.onTransition}
          />
        )}
        {showSharing && <SharingRows lineup={lineup} onClose={onClose} />}
        {showAbort && (
          <SheetItem
            testId="lineup-operator-menu-abort"
            title="Abort lineup"
            onClick={onAbort}
            danger
          />
        )}
      </div>
    </BottomSheet>
  );
}
