/**
 * ROK-1786/ROK-1830 — the Resources tab: rules and links (side by side from
 * md), then the core "Recommended mods" frame, whose sources the hub module
 * contributes (WoW: its addon panel).
 */
import type { JSX } from 'react';
import { RecommendedMods } from './recommended-mods';
import { GuildLinks } from './guild-links';
import { GuildRules } from './guild-rules';
import { useGuildProfile } from '../api/use-guild-content';
import type { HubModule } from '../../../plugins/hub-module';

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
            <RecommendedMods guildId={guildId} canEdit={canEdit} sources={mod?.modSources ?? []} />
        </div>
    );
}
