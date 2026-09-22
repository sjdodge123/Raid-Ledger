import { ARMORY_UNAVAILABLE_NOTE } from '../lib/armory-import';

/** ROK-1636: muted note explaining why the Armory tab is disabled. `id` feeds the tab's aria-describedby. */
export function ArmoryUnavailableNote({ id }: { id: string }) {
    return <p id={id} className="text-xs text-muted">{ARMORY_UNAVAILABLE_NOTE}</p>;
}

/** Shared classes for a disabled Armory tab button — tokens only. */
export const DISABLED_TAB_CLS = 'text-dim cursor-not-allowed';
