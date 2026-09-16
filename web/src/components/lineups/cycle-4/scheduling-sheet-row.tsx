/**
 * One row of the phone "Manage poll" sheet (ROK-1584).
 *
 * Lives in its own module so the three action components
 * (`SchedulingAddMembersAction` / `SchedulingRemindAction` /
 * `SchedulingCancelAction`) can render themselves as a sheet row without
 * importing `SchedulingManageSheet`, which imports THEM.
 *
 * The `aria-label` carries the full action name even when the visible title is
 * decorated, so the role-name queries in the unit + smoke specs ("Remind
 * Voters", "Cancel Poll") keep matching.
 */
import type { JSX } from 'react';
import {
  SCHEDULING_SHEET_ROW,
  SCHEDULING_SHEET_ROW_DANGER,
} from './scheduling-action-button';

export interface SchedulingSheetRowProps {
  /** Visible title AND (unless `ariaLabel` is given) the accessible name. */
  title: string;
  /** Optional second line — e.g. "3 haven't voted". */
  subline?: string | null;
  onClick: () => void;
  disabled?: boolean;
  /** Red family (Cancel Poll). */
  danger?: boolean;
  ariaLabel?: string;
  testId?: string;
}

/** A 52px row of the Manage poll sheet — see file-level docstring. */
export function SchedulingSheetRow(props: SchedulingSheetRowProps): JSX.Element {
  const { title, subline, onClick, disabled, danger, ariaLabel, testId } = props;
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
