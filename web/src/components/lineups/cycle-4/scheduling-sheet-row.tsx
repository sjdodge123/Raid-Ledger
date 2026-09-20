/**
 * One row of the phone "Manage poll" sheet (ROK-1584).
 *
 * Lives in its own module so the three action components
 * (`SchedulingAddMembersAction` / `SchedulingRemindAction` /
 * `SchedulingCancelAction`) can render themselves as a sheet row without
 * importing `SchedulingManageSheet`, which imports THEM.
 *
 * ROK-1585: the same rows sit inside the desktop "Manage poll ⋯" dropdown.
 * Wrapping them in {@link ManageMenuSurface} switches them to menu density —
 * `role="menuitem"`, 40px, no subline — without touching the action components.
 *
 * The `aria-label` carries the full action name even when the visible title is
 * decorated, so the role-name queries in the unit + smoke specs ("Remind
 * Voters", "Cancel Poll") keep matching.
 */
import { createContext, useContext, type JSX, type ReactNode } from 'react';
import {
  SCHEDULING_SHEET_ROW,
  SCHEDULING_SHEET_ROW_DANGER,
} from './scheduling-action-button';

/** Where the rows are drawn: the phone bottom sheet (default) or the desktop menu. */
type ManageSurface = 'sheet' | 'menu';

const ManageSurfaceContext = createContext<ManageSurface>('sheet');

/** Menu-density row (desktop dropdown), same tone families as the sheet row. */
const MENU_ROW_BASE =
  'flex w-full min-h-[40px] items-center gap-2 px-3 py-2 text-left text-sm ' +
  'font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const MENU_ROW = `${MENU_ROW_BASE} text-foreground hover:bg-panel`;
const MENU_ROW_DANGER = `${MENU_ROW_BASE} text-red-400 hover:bg-red-500/20`;

/** Renders every {@link SchedulingSheetRow} below it as a `role="menuitem"`. */
export function ManageMenuSurface({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ManageSurfaceContext.Provider value="menu">{children}</ManageSurfaceContext.Provider>
  );
}

export interface SchedulingSheetRowProps {
  /** Visible title AND (unless `ariaLabel` is given) the accessible name. */
  title: string;
  /** Optional second line — e.g. "3 haven't voted". */
  subline?: string | null;
  /**
   * ROK-1618: opt in to drawing {@link subline} on the MENU surface too. The
   * Manage menu's rows stay title-only (40px density); the leader menu's rows
   * carry all of their state in the subline, so hiding it there left AC8's
   * "Everyone has answered this time" visible to screen readers only.
   */
  showSubline?: boolean;
  /**
   * ROK-1618: mark the menuitem `data-keep-open`, so a menu whose close-on-
   * select handler honours it leaves the surface up. For in-place actions
   * whose feedback (in-flight → done → cooldown) is drawn in the row itself.
   */
  keepMenuOpen?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Red family (Cancel Poll). */
  danger?: boolean;
  ariaLabel?: string;
  testId?: string;
}

/** The desktop dropdown's 40px `menuitem` — title only unless `showSubline`. */
function MenuRow(props: SchedulingSheetRowProps): JSX.Element {
  const { title, subline, showSubline, keepMenuOpen } = props;
  const { onClick, disabled, danger, ariaLabel, testId } = props;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      data-keep-open={keepMenuOpen ? 'true' : undefined}
      aria-label={ariaLabel ?? title}
      className={danger ? MENU_ROW_DANGER : MENU_ROW}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{title}</span>
        {showSubline && subline && (
          <span className="truncate text-xs font-normal text-muted">
            {subline}
          </span>
        )}
      </span>
    </button>
  );
}

/** A 52px sheet row, or a 40px menuitem under {@link ManageMenuSurface}. */
export function SchedulingSheetRow(props: SchedulingSheetRowProps): JSX.Element {
  const { title, subline, onClick, disabled, danger, ariaLabel, testId } = props;
  const surface = useContext(ManageSurfaceContext);
  if (surface === 'menu') return <MenuRow {...props} />;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel ?? title}
      className={danger ? SCHEDULING_SHEET_ROW_DANGER : SCHEDULING_SHEET_ROW}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{title}</span>
        {subline && (
          <span className="truncate text-xs font-normal text-muted">
            {subline}
          </span>
        )}
      </span>
    </button>
  );
}
