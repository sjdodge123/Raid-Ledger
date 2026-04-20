/**
 * Minimal invitee multi-select input (ROK-1065).
 *
 * For the initial private-lineup shipping cut, operators paste
 * comma-separated user IDs. A richer picker with user search can replace
 * this component later without breaking the parent modal contract.
 *
 * The input tracks raw text locally so intermediate punctuation
 * (commas, spaces) isn't clobbered by parent re-renders that only
 * round-trip the parsed numeric array.
 */
import { useEffect, useRef, useState, type JSX, type ChangeEvent } from 'react';

export interface InviteeMultiSelectProps {
  value: number[];
  onChange: (next: number[]) => void;
}

/** Render a basic comma-separated user-id input with validation. */
export function InviteeMultiSelect({
  value,
  onChange,
}: InviteeMultiSelectProps): JSX.Element {
  const [raw, setRaw] = useState<string>(() => value.join(','));
  const lastEmitted = useRef<string>(value.join(','));
  useEffect(() => {
    const next = value.join(',');
    if (next !== lastEmitted.current) {
      setRaw(next);
      lastEmitted.current = next;
    }
  }, [value]);

  function handleChange(e: ChangeEvent<HTMLInputElement>): void {
    setRaw(e.target.value);
    const parsed = parseIds(e.target.value);
    lastEmitted.current = parsed.join(',');
    onChange(parsed);
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor="invitee-user-ids"
        className="block text-sm font-medium text-primary"
      >
        Invitees (user IDs)
      </label>
      <input
        id="invitee-user-ids"
        data-testid="invitee-user-ids"
        type="text"
        inputMode="numeric"
        value={raw}
        onChange={handleChange}
        placeholder="e.g. 12, 18, 31"
        className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      <p className="text-xs text-muted">
        Comma-separate numeric user IDs. Private lineups require at least one.
      </p>
    </div>
  );
}

function parseIds(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}
