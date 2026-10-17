/**
 * ROK-1830 S5 (D8-B) — "Recommended mods": the CORE frame on the Resources
 * tab. The list itself is per game, so each hub module contributes a source
 * (`HubModule.modSources`) and core only owns the heading, the source bands
 * and the empty state. WoW's source is its addon panel, unchanged — core
 * still never touches `/plugins/wow/...`.
 */
import { Suspense, type JSX } from 'react';
import { SectionTitle } from '../hub-bits';
import type { HubModSource } from '../../../plugins/hub-module';

/** The shared skeleton idiom, sized like one mod row, while a lazy source loads. */
const SOURCE_SKELETON = 'h-20 animate-pulse rounded-lg border border-edge bg-surface';

interface RecommendedModsProps {
    guildId: number;
    canEdit: boolean;
    sources: readonly HubModSource[];
}

export function RecommendedMods({ guildId, canEdit, sources }: RecommendedModsProps): JSX.Element | null {
    // No source and nothing to say to a plain member: the frame would be an
    // empty heading. An editor is told why it is empty instead.
    if (sources.length === 0 && !canEdit) return null;
    return (
        <section id="mods" className="scroll-mt-4" data-testid="guild-recommended-mods">
            <SectionTitle title="Recommended mods" blurb="What this hub asks members to install. Required ones come first in raid prep." />
            {sources.length === 0
                ? <p className="text-sm text-muted" data-testid="guild-recommended-mods-empty">No mod list for this game yet.</p>
                : sources.map((source) => (
                    <div key={source.id} className="mb-6 last:mb-0" data-testid={`guild-mod-source-${source.id}`}>
                        {sources.length > 1 && <h3 className="mb-2 text-sm font-semibold text-secondary">{source.label}</h3>}
                        <Suspense fallback={<div className={SOURCE_SKELETON} aria-busy="true" data-testid={`guild-mod-source-loading-${source.id}`} />}>
                            <source.component guildId={guildId} canEdit={canEdit} />
                        </Suspense>
                    </div>
                ))}
        </section>
    );
}
