/**
 * ROK-1830 — the WoW guild's tab components, adapted to `HubCtx`. The Raids
 * tab itself is unchanged (`raids-tab.tsx`); this only hands it the query the
 * shell already holds.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { GuildRaidsTab } from './raids-tab';

export function WowRaidsTab({ raids }: HubCtx): JSX.Element {
    return <GuildRaidsTab query={raids} />;
}

/** A tab declared for the frame but not yet filled — never rendered (`visible: () => false`). */
export function HiddenTab(): null {
    return null;
}
