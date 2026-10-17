/**
 * ROK-1830 — "does the Resources tab have anything in it?" for the sections a
 * hub module contributes.
 *
 * Core must not know what makes a module's section non-empty (before r2 it ran
 * the WoW addons query itself and pointed at `/plugins/wow/...`, which a
 * non-WoW kind would have errored on), so each section answers through its own
 * `useVisible` hook.
 *
 * r4 — the answer is produced DURING RENDER, above the tab nav, not reported up
 * from a child. r2/r3 mounted one probe per section and let it `report` through
 * state (passive effect, then layout effect): both are a child-to-parent round
 * trip, so the earliest render that could see the answer was the one AFTER the
 * commit that first drew the nav. On a warm react-query cache that made the tab
 * row paint once without Resources and once with it, whatever the effect phase.
 * Here the hooks run in an ancestor of the nav and hand the booleans straight
 * down, so a cached answer is part of the very first commit.
 *
 * Hook-order legality: the hook list is positional and varies with the section
 * set, so the component that calls them is keyed by those sections — a module
 * switching on or off remounts it instead of changing one instance's hook count.
 * That remount takes the hero/nav/panel with it, so the page waits for the
 * plugin list to hydrate before mounting any of it (`usePluginsHydrated`) and
 * the key then only moves on a genuine plugin toggle from the admin page.
 */
import type { JSX, ReactNode } from 'react';
import type { HubResourceSection } from '../../plugins/hub-module';

export interface HubResourceVisibilityProps {
    sections: readonly HubResourceSection[];
    guildId: number;
    /** Rendered with `true` once any section reports it has something to show. */
    children: (anyVisible: boolean) => ReactNode;
}

type VisibilityHook = NonNullable<HubResourceSection['useVisible']>;

/** Stable per-function id, so swapping an implementation under the same section id changes the key. */
const hookIds = new WeakMap<VisibilityHook, number>();
let nextHookId = 0;
function hookId(hook: VisibilityHook): number {
    const seen = hookIds.get(hook);
    if (seen !== undefined) return seen;
    nextHookId += 1;
    hookIds.set(hook, nextHookId);
    return nextHookId;
}

/**
 * Identity of the hook list: its length, which entries ask a hook at all, and
 * WHICH hook each one asks — a replacement implementation under the same
 * section id may call a different number of hooks internally, so the key has to
 * move with the function, not just with the id.
 */
function sectionsKey(sections: readonly HubResourceSection[]): string {
    return sections.map((s) => `${s.id}:${s.useVisible ? `ask#${hookId(s.useVisible)}` : 'always'}`).join('|');
}

function SectionAnswers({ sections, guildId, children }: HubResourceVisibilityProps): JSX.Element {
    // `sections` is fixed for this instance (see the key below), so these hooks
    // run in the same order and count on every render of it.
    const answers: boolean[] = [];
    for (const section of sections) {
        // A section that declares no `useVisible` always counts as having content.
        if (!section.useVisible) { answers.push(true); continue; }
        // A hook call in a loop, legal only because the list is fixed per instance.
        answers.push(section.useVisible(guildId));
    }
    return <>{children(answers.some(Boolean))}</>;
}

export function HubResourceVisibility(props: HubResourceVisibilityProps): JSX.Element {
    return <SectionAnswers key={sectionsKey(props.sections)} {...props} />;
}
