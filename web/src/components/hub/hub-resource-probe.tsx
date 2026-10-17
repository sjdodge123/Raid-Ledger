/**
 * ROK-1830 — the probe that lets a hub module's Resources section answer "do I
 * have anything to show?" with hooks of its own.
 *
 * It renders nothing. It exists so the section's `useVisible` hook has a
 * component to live in: a plugin switching on or off mounts/unmounts a probe,
 * which is legal, where calling a varying number of hooks inside core's own
 * body would not be. See `hub-resource-visibility.tsx`.
 */
import { useLayoutEffect } from 'react';

export type ResourceSectionReport = (id: string, visible: boolean) => void;

export interface ResourceSectionProbeProps {
    id: string;
    guildId: number;
    useSectionVisible: (guildId: number) => boolean;
    report: ResourceSectionReport;
}

export function ResourceSectionProbe({ id, guildId, useSectionVisible, report }: ResourceSectionProbeProps): null {
    const visible = useSectionVisible(guildId);
    // Layout, not passive: a passive effect reports one PAINTED commit late, so
    // on a warm react-query cache the tab row flashes without Resources first.
    useLayoutEffect(() => {
        report(id, visible);
        return () => report(id, false);
    }, [id, visible, report]);
    return null;
}
