/**
 * Slider + text-field subcomponents extracted from StartLineupModal to keep
 * the main file under the 300-line limit (ROK-1064).
 */
import type { JSX } from 'react';

const MIN_DAYS = 1;
const MAX_DAYS = 30;
const DESCRIPTION_MAX = 500;

/** A range slider measured in whole days (1-30). */
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
  const days = Math.round(value / 24) || 1;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-secondary">{label}</label>
        <span className="text-sm text-muted tabular-nums">
          {days} {days === 1 ? 'day' : 'days'}
        </span>
      </div>
      <input
        type="range"
        name={name}
        data-testid={testId}
        min={MIN_DAYS}
        max={MAX_DAYS}
        step={1}
        value={days}
        onChange={(e) => onChange(Number(e.target.value) * 24)}
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
      <div className="flex justify-between text-xs text-muted/60 mt-1">
        <span>1 day</span>
        <span>30 days</span>
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
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
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
        className="w-full h-2 bg-surface/50 rounded-lg appearance-none cursor-pointer accent-emerald-500"
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
