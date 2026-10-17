import { ARMORY_UNAVAILABLE_NOTE } from '../lib/armory-import';

/** ROK-1636: muted note explaining why the Armory tab is disabled. `id` feeds the tab's aria-describedby. */
export function ArmoryUnavailableNote({ id }: { id: string }) {
    return <p id={id} className="text-xs text-muted">{ARMORY_UNAVAILABLE_NOTE}</p>;
}

/**
 * Manual / Import-from-Armory tabs (ROK-1648, ruling 6 exception): `Button variant="ghost" size="sm"`
 * in {@link ARMORY_TAB_TRACK_CLS}. ON and disabled paint come from `aria-pressed` / `aria-disabled`, so
 * the ghost hover never outranks them. Tokens only — the segmented look without radio semantics,
 * because the Import tab must stay focusable and described by the note while disabled (ROK-1636).
 */
export const ARMORY_TAB_CLS =
    'flex-1 aria-pressed:bg-overlay aria-pressed:text-foreground ' +
    'aria-disabled:bg-transparent aria-disabled:text-dim aria-disabled:cursor-not-allowed';

/** The track the two tabs sit in — matches `RadioGroup appearance="segmented"`. */
export const ARMORY_TAB_TRACK_CLS = 'flex gap-1 p-1 bg-panel border border-edge rounded-lg';
