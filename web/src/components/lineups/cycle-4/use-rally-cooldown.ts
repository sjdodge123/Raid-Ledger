/**
 * The Rally nudge's session-only cooldown (ROK-1618, D4).
 *
 * Its own module — and OWNED BY THE MENU, not by the row — because the phone
 * branch of `SchedulingLeaderMenu` mounts the sheet only while it is open. A
 * cooldown held inside `SchedulingRallyAction` would be thrown away on every
 * close, so the reopened sheet offered Rally again and the second press earned
 * the server's 429. `SchedulingLeaderMenu` stays mounted on both branches, so
 * the hook lives there and the armed hours are passed down.
 */
import { useEffect, useRef, useState } from 'react';

const HOUR_MS = 60 * 60 * 1000;

export interface RallyCooldown {
  /** Whole hours left on the cooldown the server reported, or `null`. */
  hours: number | null;
  /** Arm from the server's `cooldownUntil`; a past/now value is a no-op. */
  arm: (cooldownUntil: string) => void;
}

/**
 * Whole hours left on the cooldown the server just reported, or `null`.
 *
 * Armed from the mutation's success callback rather than an effect (a render
 * may not read the clock, and setting state inside an effect cascades). The
 * timer clears it so a page left open past the window re-enables the row —
 * the Codex P2 fix `SchedulingRemindAction` carries.
 */
export function useArmedCooldown(): RallyCooldown {
  const [hours, setHours] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const arm = (cooldownUntil: string): void => {
    const remaining = Date.parse(cooldownUntil) - Date.now();
    // An empty-audience rally refunds the cooldown (`cooldownUntil: now`).
    if (!(remaining > 0)) return;
    setHours(Math.max(1, Math.ceil(remaining / HOUR_MS)));
    timer.current = setTimeout(() => setHours(null), remaining);
  };
  return { hours, arm };
}
