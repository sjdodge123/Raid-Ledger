/**
 * Universal Submit ritual bar (ROK-1296, U4).
 *
 * Sits at the bottom of every page-with-actions (S1 Nominating, Sv Voting,
 * Ss/Sx Scheduling — NOT S3 Decided). Closes the "did that count?"
 * cognitive loop: autosave keeps the data safe, the Submit click declares
 * "I'm done deciding." Operator quorum counts use *submissions*, not
 * autosave touches.
 *
 * Visual tokens mirror the wireframe at
 * `web/src/dev/simplify-wireframes/simplify-composite-mocks.tsx:70-89`.
 * The component is purely props-driven: composites are responsible for
 * deriving `kind` via {@link deriveSubmitKind} and supplying labels.
 */
import type { JSX } from 'react';
import type { SubmitKind } from './derive-kind';

/** Props for {@link SubmitBar}. */
export interface SubmitBarProps {
  /** Visual kind — see {@link SubmitKind}. */
  kind: SubmitKind;
  /** Left-side status copy (e.g. "1 of 3 votes used · autosaved"). */
  status: string;
  /** CTA label (e.g. "Submit my votes →"). */
  cta: string;
  /** Optional small italic line below the row (partial only — ignored otherwise). */
  nudge?: string;
  /** Fired on click for pre/partial/post; ignored for empty (button is disabled). */
  onCtaClick?: () => void;
  /**
   * Optional override copy that explains why the CTA is disabled. Composed
   * into the disabled button's `aria-label` so screen readers communicate
   * the reason. Ignored for non-empty kinds.
   */
  disabledReason?: string;
}

const WRAP_CLS: Record<SubmitKind, string> = {
  empty: 'border-edge bg-overlay/20 opacity-60',
  partial: 'border-emerald-500/25 bg-emerald-500/5',
  pre: 'border-emerald-500/40 bg-emerald-500/5',
  post: 'border-edge bg-overlay/30',
};

const PRIMARY_BTN_CLS =
  'inline-block px-2 py-0.5 text-[10px] rounded bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed';
const GHOST_BTN_CLS =
  'inline-block px-2 py-0.5 text-[10px] rounded border border-edge text-muted disabled:opacity-50 disabled:cursor-not-allowed';

/** Resolve the prefix glyph shown before the status copy. */
function prefixFor(kind: SubmitKind): string {
  if (kind === 'post') return '✓ ';
  if (kind === 'empty') return '⊘ ';
  return '';
}

/** Resolve the accessible label for the CTA button. */
function ariaLabelFor(
  kind: SubmitKind,
  cta: string,
  disabledReason?: string,
): string {
  if (kind !== 'empty') return cta;
  const reason = disabledReason ?? 'action required first';
  return `Submit (disabled — ${reason})`;
}

/** Resolve the CTA button class for the given kind. */
function ctaCls(kind: SubmitKind): string {
  return kind === 'pre' || kind === 'partial' ? PRIMARY_BTN_CLS : GHOST_BTN_CLS;
}

/** The Submit ritual bar — see file-level docstring for usage. */
export function SubmitBar(props: SubmitBarProps): JSX.Element {
  const { kind, status, cta, nudge, onCtaClick, disabledReason } = props;
  const disabled = kind === 'empty';
  const ariaLabel = ariaLabelFor(kind, cta, disabledReason);
  const showNudge = kind === 'partial' && nudge !== undefined;
  return (
    <div className={`mt-2 border ${WRAP_CLS[kind]} rounded p-2`}>
      <div className="flex justify-between items-center">
        <div className="text-[11px] text-secondary">
          {prefixFor(kind)}
          {status}
        </div>
        <button
          type="button"
          className={ctaCls(kind)}
          onClick={onCtaClick}
          disabled={disabled}
          aria-label={ariaLabel}
        >
          {cta}
        </button>
      </div>
      {showNudge && (
        <div className="text-[10px] text-muted italic mt-1">{nudge}</div>
      )}
    </div>
  );
}
