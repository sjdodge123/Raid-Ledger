/**
 * Shared navigational chip (ROK-1101 TD-4).
 *
 * `OtherActiveLineups` and `SchedulingBanner` had a byte-identical chip
 * className between them. Extracted so the two stay in step; the class list
 * lives here and nowhere else.
 *
 * Deliberately NOT used by `InviteeList`: that row is an `<li>` with a
 * bordered, tighter, non-navigational style (`px-2 py-1 rounded border
 * border-edge bg-panel`). The review grouped it with these two, but it is a
 * list row rather than a link chip, and collapsing them would mean inventing
 * variants for a shape that has exactly one user.
 */
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** The one definition of the chip's look. */
export const NAV_CHIP_CLASS =
  'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-overlay transition-colors text-sm';

export interface NavChipProps {
  /** Router destination. */
  to: string;
  children: ReactNode;
  /** Optional `data-testid`; omitted entirely when not supplied. */
  testId?: string;
}

/** A chip that navigates. Caller supplies the inner spans. */
export function NavChip({ to, children, testId }: NavChipProps): JSX.Element {
  return (
    <Link to={to} className={NAV_CHIP_CLASS} data-testid={testId}>
      {children}
    </Link>
  );
}
