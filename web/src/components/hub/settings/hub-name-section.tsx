/**
 * ROK-1950 — "Hub name" in the hub settings sheet. It sits in `LeaderSections`,
 * so only the hub's Leader and staff see it (never a community Officer).
 * Community, server and (ROK-2015) WoW guild hubs rename. A server hub or WoW
 * guild carrying a Raid Ledger name also gets a Reset back to its source name
 * (Pelican's / the in-game one). Shape copied from the community `BlurbSection`.
 */
import { useState, type JSX } from 'react';
import { HUB_NAME_MAX, HubNameSchema, type GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../../plugins/hub-module';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { SettingsSection } from './settings-rows';
import { useHubRename } from './use-hub-rename';

/** The field hint; a server hub or WoW guild also names what Reset goes back to. */
function nameHint(page: GuildPage): string {
    const base = 'Shown on the hub, in the directory and on Discord.';
    const { guild } = page;
    if (guild.kind === 'wow_guild') {
        return guild.inGameName ? `${base} In game this guild is called “${guild.inGameName}”. LedgerLink imports keep the name you set here.` : base;
    }
    const source = guild.kind === 'game_server' ? page.server?.serverName : undefined;
    return source ? `${base} Pelican calls this server “${source}”.` : base;
}

const RESET_LABEL: Partial<Record<GuildPage['guild']['kind'], string>> = {
    game_server: 'Reset to server name',
    wow_guild: 'Reset to in-game name',
};

function HubNameForm({ page }: { page: GuildPage }): JSX.Element {
    const { guild } = page;
    const rename = useHubRename(guild.id);
    const [draft, setDraft] = useState(guild.name);
    const next = draft.trim();
    const canSave = next !== guild.name && HubNameSchema.safeParse(next).success;
    const resetLabel = guild.nameOverridden === true ? RESET_LABEL[guild.kind] : undefined;
    return (
        <SettingsSection title="Hub name" testId="hub-name-section">
            <Field label="Hub name" hint={nameHint(page)}>
                <Input value={draft} maxLength={HUB_NAME_MAX} onChange={(e) => setDraft(e.target.value)} data-testid="hub-name-input" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" disabled={!canSave || rename.isPending}
                    onClick={() => rename.mutate(next)} data-testid="hub-name-save">Save name</Button>
                {resetLabel && (
                    <Button variant="secondary" size="sm" disabled={rename.isPending}
                        onClick={() => rename.mutate(null)} data-testid="hub-name-reset">{resetLabel}</Button>
                )}
            </div>
        </SettingsSection>
    );
}

/** The settings-sheet section. Re-keyed on the name so a refetch resets the draft. */
export function HubNameSection({ ctx }: { ctx: HubCtx }): JSX.Element {
    return <HubNameForm key={ctx.page.guild.name} page={ctx.page} />;
}
