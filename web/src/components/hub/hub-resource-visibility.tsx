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

const NO_IDS: ReadonlySet<string> = new Set<string>();

/** Answers are only ever read back for the guild they were reported for. */
interface ReportedVisibility {
    guildId: number;
    ids: ReadonlySet<string>;
}

export function useResourceSectionVisibility(
    sections: readonly HubResourceSection[], guildId: number,
): ResourceSectionVisibility {
    const [reported, setReported] = useState<ReportedVisibility>(() => ({ guildId, ids: NO_IDS }));
    const report = useCallback<ResourceSectionReport>((id, visible) => {
        setReported((prev) => {
            const ids = prev.guildId === guildId ? prev.ids : NO_IDS;
            if (ids.has(id) === visible) return prev.guildId === guildId ? prev : { guildId, ids };
            const next = new Set(ids);
            if (visible) next.add(id);
            else next.delete(id);
            return { guildId, ids: next };
        });
    }, [guildId]);
    const probes = (
        <>
            {sections.map((section) => (section.useVisible
                ? (
                    <ResourceSectionProbe
                        key={`${guildId}:${section.id}`} id={section.id} guildId={guildId}
                        useSectionVisible={section.useVisible} report={report}
                    />
                )
                : null))}
        </>
    );
    // Navigating to another guild drops the previous guild's answers outright,
    // rather than showing them until its probes have re-reported.
    const visibleIds = reported.guildId === guildId ? reported.ids : NO_IDS;
    // A section that declares no `useVisible` always counts as having content.
    const anyVisible = sections.some((section) => !section.useVisible) || visibleIds.size > 0;
    return { anyVisible, probes };
}
