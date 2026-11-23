/**
 * ROK-1813 (D10) — "Public recruiting card" in a WoW guild hub's settings
 * sheet: one switch (off by default), and once on the read-only public link
 * with a copy button. Only `canEdit` viewers (Leader, Officers, staff) see it —
 * a rank-0 GM without an editor grant does not (spec N1). Approved mockup:
 * `pending-approval/_approved/ROK-1813-guild-visitor-card/mockup.html` §3.
 */
import type { JSX } from 'react';
import type { GuildPublicCardSettings } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { CopyButton } from '../../../components/ui/CopyButton';
import { Input } from '../../../components/ui/input';
import { SettingsSection, SettingsSwitchRow } from '../../../components/hub/settings/settings-rows';
import { toast } from '../../../lib/toast';
import { useGuildPublicCard, useSetGuildPublicCard } from './use-guild-public-card';
import { publicCardUrl } from './public-card-settings.helpers';

const TITLE = 'Public recruiting card';
const BLURB = "A signed-out page for recruiting. It isn't listed in Raid Ledger or searchable.";
const HINT = 'Anyone with the link sees your guild name, realm, rough size and recruitment. Nothing else.';
const NEVER = 'Never shown: roster, member names, GM post, rules, links, Discord, events, attendance, editors.';

/** The hub's settings-sheet section; renders nothing for a viewer without `canEdit`. */
export function PublicCardSettingsSection({ page }: HubCtx): JSX.Element | null {
    const { guild, viewer } = page;
    const allowed = viewer.canEdit && guild.kind === 'wow_guild';
    const query = useGuildPublicCard(guild.id, allowed);
    if (!allowed || query.data === undefined) return null;
    return (
        <SettingsSection title={TITLE} blurb={BLURB} testId="wow-public-card-section">
            <CardSwitch guildId={guild.id} settings={query.data} />
            {query.data.enabled && query.data.slug !== null && <CardLink slug={query.data.slug} />}
            <p className="text-xs text-dim" data-testid="wow-public-card-never">{NEVER}</p>
        </SettingsSection>
    );
}

function CardSwitch({ guildId, settings }: { guildId: number; settings: GuildPublicCardSettings }): JSX.Element {
    const set = useSetGuildPublicCard(guildId);
    const onChange = (enabled: boolean): void => {
        set.mutate(enabled, { onError: () => toast.error("Couldn't update the public card.") });
    };
    return (
        <SettingsSwitchRow label={TITLE} hint={HINT} checked={set.isPending ? (set.variables ?? settings.enabled) : settings.enabled}
            disabled={set.isPending} onChange={onChange} testId="wow-public-card-toggle" />
    );
}

function CardLink({ slug }: { slug: string }): JSX.Element {
    const url = publicCardUrl(slug);
    return (
        <div className="flex items-center gap-2">
            <Input readOnly value={url} aria-label="Public card link" mono className="min-h-11 text-xs text-secondary"
                onFocus={(e) => e.currentTarget.select()} data-testid="wow-public-card-link" />
            <CopyButton text={url} className="grid h-11 w-11 flex-none place-items-center border border-edge bg-panel" />
        </div>
    );
}
