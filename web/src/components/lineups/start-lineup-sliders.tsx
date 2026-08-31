/**
 * Slider + text-field subcomponents extracted from StartLineupModal to keep
 * the main file under the 300-line limit (ROK-1064).
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { formatDurationHours } from './start-lineup-config';

const MIN_HOURS = 1;
/** Slider ceiling: 7 days. Covers every preset (Series tops out at 96h). */
const SLIDER_MAX_HOURS = 168;
/** Legacy 30-day ceiling — reachable via the numeric field, not the drag. */
const MAX_HOURS = 720;
const DESCRIPTION_MAX = 500;

/** Clamp a duration into the numeric field's accepted range. */
function clampHours(v: number): number {
  return Math.min(MAX_HOURS, Math.max(0.25, v));
}

/**
 * Exact-entry companion to the duration track, in hours.
 *
 * Holds the raw string while the field has focus (ROK-1441, Codex review).
 * Clamping every keystroke made fractional entry impossible: typing "1.5"
 * coerced the intermediate "1." back to 1, so React re-rendered and ate the
 * decimal point, and a leading "0" was rewritten to the 0.25 minimum before
 * the operator could type the rest. The draft is committed and clamped on
 * blur; in-range intermediates still propagate live so the slider and the
 * readout track what is being typed.
 */
function HoursInput({
  label,
  testId,
  value,
  onChange,
}: {
  label: string;
  testId: string;
  value: number;
  onChange: (v: number | '') => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);

  function handleChange(raw: string): void {
    setDraft(raw);
    if (raw === '') return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0.25 && parsed <= MAX_HOURS) {
      onChange(parsed);
    }
  }

  function handleBlur(raw: string): void {
    setDraft(null);
    if (raw === '') {
      onChange('');
      return;
    }
    const parsed = Number(raw);
    onChange(Number.isFinite(parsed) ? clampHours(parsed) : value);
  }

  return (
    <input
      type="number"
      data-testid={testId}
      aria-label={`${label} duration in hours`}
      min={0.25}
      max={MAX_HOURS}
      step="any"
      value={draft ?? value}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={(e) => handleBlur(e.target.value)}
      className="w-16 shrink-0 px-2 py-1 text-sm bg-panel border border-edge rounded-lg text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
    />
  );
}

/**
 * A duration slider (ROK-1441: hour-granular, was day-granular).
 *
 * The track runs 1h-168h in 1h steps so same-day values like the Tonight
 * preset's 5h are reachable by drag; before ROK-1441 the smallest draggable
 * value was 24h, which snapped any sub-day preset value to whole days on the
 * first touch. The paired numeric field keeps the legacy 30-day ceiling
 * reachable without a 720-stop drag, and the readout always reflects the TRUE
 * current value — so a sub-hour preset value still renders as "15 min".
 */
export function DurationSlider({
  label,
  name,
  testId,
  value,
  onChange,
}: {
  label: string;
  name: string;
  testId: string;
  value: number;
  onChange: (v: number | '') => void;
}): JSX.Element {
  const sliderHours = Math.min(
    SLIDER_MAX_HOURS,
    Math.max(MIN_HOURS, Math.round(value)),
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">{label}</label>
        <span className="text-sm text-muted tabular-nums">
          {formatDurationHours(value)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          name={name}
          data-testid={testId}
          min={MIN_HOURS}
          max={SLIDER_MAX_HOURS}
          step={1}
          value={sliderHours}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 bg-overlay rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
        <HoursInput
          label={label}
          testId={`${testId}-hours`}
          value={value}
          onChange={onChange}
        />
        <span className="shrink-0 text-xs text-muted">hrs</span>
      </div>
    </div>
  );
}

/** Votes-per-player slider (1-10). */
export function VotesPerPlayerSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">
          Votes per Player
        </label>
        <span className="text-sm text-muted tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        data-testid="votes-per-player"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-overlay rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-muted/60 mt-1">
        <span>1 vote</span>
        <span>10 votes</span>
      </div>
    </div>
  );
}

/** Match-threshold slider (0-100 in 5-pt steps). */
export function ThresholdSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">
          Match Threshold
        </label>
        <span className="text-sm text-muted tabular-nums">{value}%</span>
      </div>
      <input
        type="range"
        data-testid="match-threshold"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-overlay rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-muted/60 mt-1">
        <span>More matches</span>
        <span>Fewer, larger matches</span>
      </div>
    </div>
  );
}

/** Title text field (required). */
export function TitleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div>
      <label
        htmlFor="lineup-title"
        className="block text-sm font-medium text-secondary mb-1"
      >
        Title <span className="text-rose-400">*</span>
      </label>
      <input
        id="lineup-title"
        type="text"
        required
        maxLength={100}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Lineup — April 2026"
        className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
      />
    </div>
  );
}

/** Description textarea with a character counter. */
export function DescriptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label
          htmlFor="lineup-description"
          className="block text-sm font-medium text-secondary"
        >
          Description
        </label>
        <span className="text-xs text-muted tabular-nums">
          {value.length} / {DESCRIPTION_MAX}
        </span>
      </div>
      <textarea
        id="lineup-description"
        rows={3}
        maxLength={DESCRIPTION_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional markdown — **bold**, *italic*, `code`, [link](https://example.com)"
        className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
      />
    </div>
  );
}

/** Three-way toggle for tiebreaker mode. */
export function TiebreakerPicker({
  value,
  onChange,
}: {
  value: 'bracket' | 'veto' | null;
  onChange: (v: 'bracket' | 'veto' | null) => void;
}): JSX.Element {
  const opts: ReadonlyArray<readonly [('bracket' | 'veto' | null), string]> = [
    ['bracket', 'Bracket'],
    ['veto', 'Veto'],
    [null, 'None'],
  ];
  return (
    <div className="border-t border-edge/30 pt-4">
      <label className="text-sm font-medium text-secondary">
        Tiebreaker Mode
      </label>
      <p className="text-xs text-muted mb-2">
        Used when voting produces tied games at deadline.
      </p>
      <div className="flex gap-2">
        {opts.map(([val, label]) => (
          <button
            key={String(val)}
            type="button"
            onClick={() => onChange(val)}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              value === val
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400'
                : 'bg-panel border-edge text-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
