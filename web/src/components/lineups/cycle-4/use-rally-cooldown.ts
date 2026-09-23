/**
 * The Rally nudge's session-only cooldown (ROK-1618, D4).
 *
 * Its own module, and owned ABOVE every menu — ROK-1635 hoists the single
 * instance into `useSchedulingTimeMenus`, which hands the same object to the
 * leading card's menu and to every ladder row's. Two reasons, and the second
 * is the load-bearing one:
 *
 * 1. The phone branch mounts its sheet only while it is open, so a cooldown
 *    held inside `SchedulingRallyAction` was thrown away on every close and
 *    the reopened sheet offered Rally again (the second press earned a 429).
 * 2. The server's rally key is per POLL, not per time (6h). N independently
 *    idle Rally rows would therefore all look pressable after one rally and
 *    all but the first would 429 — so one arm has to take them ALL cold.
 *
 * Moving it back down into a menu or a row silently re-breaks (2).
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
    // One cooldown now backs N menus, so a second arm inside the window is
    // reachable — replacing a live timer without clearing it would leak it.
    if (timer.current) clearTimeout(timer.current);
    setHours(Math.max(1, Math.ceil(remaining / HOUR_MS)));
    timer.current = setTimeout(() => setHours(null), remaining);
  };
  return { hours, arm };
}
