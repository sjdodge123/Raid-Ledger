/**
 * ROK-1444 — "open voting early" nomination target, under "More options".
 *
 * Optional by design: `null` keeps the lineup on today's deadline-only
 * behaviour, so the control is a toggle plus a slider rather than a bare
 * slider with a magic "off" position.
 *
 * The target is a percentage of the DYNAMIC nomination cap
 * (`max(20, nominators x 5)`), not an absolute game count, so the helper copy
 * names the cap explicitly — the denominator is the part operators get wrong.
 * The cap ratchets upward only (`nomination_cap_peak`), so the bar never moves
 * backwards under the group mid-lineup.
 */
import type { JSX } from 'react';

/** Percentage used when the operator first switches the target on. */
export const DEFAULT_NOMINATION_TARGET_PCT = 75;

export function NominationTargetControl({
  value,
  onChange,
}: {
  /** Percentage of the cap, or null when the target is off. */
  value: number | null;
  onChange: (next: number | null) => void;
}): JSX.Element {
  const enabled = value !== null;
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          data-testid="nomination-target-enabled"
          checked={enabled}
          onChange={(e) =>
            onChange(e.target.checked ? DEFAULT_NOMINATION_TARGET_PCT : null)
          }
          className="mt-0.5 h-4 w-4 accent-emerald-500"
        />
        <span className="text-sm text-secondary">
          Open voting early once enough games are nominated
          <span className="block text-xs text-muted">
            Off = voting opens only when the building phase deadline expires.
          </span>
        </span>
      </label>
      {enabled && (
        <div className="pl-6">
          <div className="flex items-center justify-between mb-2">
            <label
              className="text-sm font-medium text-secondary"
              htmlFor="nomination-target-pct"
            >
              Nomination target
            </label>
            <span className="text-sm text-muted tabular-nums">{value}%</span>
          </div>
          <input
            id="nomination-target-pct"
            type="range"
            data-testid="nomination-target-pct"
            min={25}
            max={100}
            step={5}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-2 bg-overlay rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <p className="text-xs text-muted/80 mt-1">
            Percentage of the nomination cap — 20 games, plus 5 for every extra
            person who nominates. Voting still opens at the deadline if the
            target is never reached.
          </p>
        </div>
      )}
    </div>
  );
}
