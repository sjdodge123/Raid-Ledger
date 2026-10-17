/**
 * ROK-1786/ROK-1830 — the Resources tab: rules and links (side by side from
 * md), then whatever sections the hub module adds below them (WoW: the
 * recommended addons).
 */
import { Suspense, type JSX } from 'react';
import { GuildLinks } from './guild-links';
import { GuildRules } from './guild-rules';
import { useGuildProfile } from '../api/use-guild-content';
import type { HubModule } from '../../../plugins/hub-module';

/** The shared skeleton idiom, sized like one addon row, while a lazy section loads. */
const SECTION_SKELETON = 'h-20 animate-pulse rounded-lg border border-edge bg-surface';

interface GuildResourcesProps {
    guildId: number;
    canEdit: boolean;
    module: HubModule | undefined;
}

export function GuildResources({ guildId, canEdit, module: mod }: GuildResourcesProps): JSX.Element {
    const profile = useGuildProfile(guildId);
    if (profile.error) {
        return <p className="py-8 text-center text-sm text-muted" data-testid="guild-resources-error">We couldn&apos;t load this guild&apos;s resources. Try again in a moment.</p>;
    }
    if (!profile.data) return <div className="h-64 animate-pulse rounded-lg border border-edge bg-surface" aria-busy="true" />;
    return (
        <div className="flex flex-col gap-6" data-testid="guild-resources">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <GuildRules guildId={guildId} rules={profile.data.rules} canEdit={canEdit} />
                <GuildLinks guildId={guildId} links={profile.data.links} canEdit={canEdit} />
            </div>
            {(mod?.resourceSections ?? []).map((section) => (
                <Suspense
                    key={section.id}
                    fallback={<div className={SECTION_SKELETON} aria-busy="true" data-testid={`guild-resource-loading-${section.id}`} />}
                >
                    <section.component guildId={guildId} canEdit={canEdit} />
                </Suspense>
            ))}
        </div>
    );
}
