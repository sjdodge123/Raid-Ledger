/**
 * ROK-1786 — the Resources tab: rules, links (side by side from md) and the
 * recommended addons below.
 */
import type { JSX } from 'react';
import { GuildAddons } from './guild-addons';
import { GuildLinks } from './guild-links';
import { GuildRules } from './guild-rules';
import { useGuildAddons, useGuildProfile } from '../api/use-guild-content';

export function GuildResources({ guildId, canEdit }: { guildId: number; canEdit: boolean }): JSX.Element {
    const profile = useGuildProfile(guildId);
    const addons = useGuildAddons(guildId);
    if (profile.error || addons.error) {
        return <p className="py-8 text-center text-sm text-muted" data-testid="guild-resources-error">We couldn&apos;t load this guild&apos;s resources. Try again in a moment.</p>;
    }
    if (!profile.data || !addons.data) return <div className="h-64 animate-pulse rounded-lg border border-edge bg-surface" aria-busy="true" />;
    return (
        <div className="flex flex-col gap-6" data-testid="guild-resources">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <GuildRules guildId={guildId} rules={profile.data.rules} canEdit={canEdit} />
                <GuildLinks guildId={guildId} links={profile.data.links} canEdit={canEdit} />
            </div>
            <GuildAddons guildId={guildId} list={addons.data} canEdit={canEdit} />
        </div>
    );
}
