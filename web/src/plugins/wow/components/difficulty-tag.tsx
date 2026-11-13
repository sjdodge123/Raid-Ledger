/**
 * ROK-1789 Part B (B-4) — the bordered difficulty label ("40-player") shown
 * after a boss name. One component for the Overview "Raid progress" card
 * (`raid-progress-rows.tsx`) and the Progression tab (`progression-boss-row.tsx`);
 * each passes its own `testId` so existing selectors stay put.
 */
import type { JSX } from 'react';

/** The difficulty tag beside a boss name. */
export function DifficultyTag({ label, testId }: { label: string; testId: string }): JSX.Element {
    return (
        <span data-testid={testId}
            className="ml-1.5 rounded border border-edge px-1 text-[11px] font-normal text-dim">{label}</span>
    );
}
