/**
 * ROK-1830 — "does the Resources tab have anything in it?" for the sections a
 * hub module contributes.
 *
 * Core must not know what makes a module's section non-empty (before r2 it ran
 * the WoW addons query itself and pointed at `/plugins/wow/...`, which a
 * non-WoW kind would have errored on), so each section answers through its own
 * `useVisible` hook. Core calls that hook inside one `ResourceSectionProbe`
 * per section rather than in its own body — see that file for why.
 */
import { useCallback, useState, type JSX } from 'react';
import type { HubResourceSection } from '../../plugins/hub-module';
import { ResourceSectionProbe, type ResourceSectionReport } from './hub-resource-probe';

export interface ResourceSectionVisibility {
    /** True once any module section reports it has something to show. */
    anyVisible: boolean;
    /** Render this anywhere inside the page — it draws nothing. */
    probes: JSX.Element;
}

export function useResourceSectionVisibility(
    sections: readonly HubResourceSection[], guildId: number,
): ResourceSectionVisibility {
    const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(() => new Set<string>());
    const report = useCallback<ResourceSectionReport>((id, visible) => {
        setVisibleIds((prev) => {
            if (prev.has(id) === visible) return prev;
            const next = new Set(prev);
            if (visible) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);
    const probes = (
        <>
            {sections.map((section) => (section.useVisible
                ? (
                    <ResourceSectionProbe
                        key={section.id} id={section.id} guildId={guildId}
                        useSectionVisible={section.useVisible} report={report}
                    />
                )
                : null))}
        </>
    );
    // A section that declares no `useVisible` always counts as having content.
    const anyVisible = sections.some((section) => !section.useVisible) || visibleIds.size > 0;
    return { anyVisible, probes };
}
