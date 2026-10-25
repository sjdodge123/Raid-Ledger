/**
 * ROK-1950 — "Hub name" in the hub settings sheet. It sits in `LeaderSections`,
 * so only the hub's Leader and staff see it (never a community Officer).
 * Community and server hubs rename; a WoW guild's name comes from the game
 * (OQ-1), so it gets no control. A server hub carrying a Raid Ledger name also
 * gets "Reset to server name". Shape copied from the community `BlurbSection`.
 */
import { useState, type JSX } from 'react';
import { HUB_NAME_MAX, HubNameSchema, type GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../../plugins/hub-module';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { SettingsSection } from './settings-rows';
import { useHubRename } from './use-hub-rename';

/** The field hint; a server hub also names what Reset goes back to. */
function nameHint(page: GuildPage): string {
    const base = 'Shown on the hub, in the directory and on Discord.';
    const source = page.guild.kind === 'game_server' ? page.server?.serverName : undefined;
    return source ? `${base} Pelican calls this server “${source}”.` : base;
}

function HubNameForm({ page }: { page: GuildPage }): JSX.Element {
    const { guild } = page;
    const rename = useHubRename(guild.id);
    const [draft, setDraft] = useState(guild.name);
    const next = draft.trim();
    const canSave = next !== guild.name && HubNameSchema.safeParse(next).success;
    const canReset = guild.kind === 'game_server' && guild.nameOverridden === true;
    return (
        <SettingsSection title="Hub name" testId="hub-name-section">
            <Field label="Hub name" hint={nameHint(page)}>
                <Input value={draft} maxLength={HUB_NAME_MAX} onChange={(e) => setDraft(e.target.value)} data-testid="hub-name-input" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" disabled={!canSave || rename.isPending}
                    onClick={() => rename.mutate(next)} data-testid="hub-name-save">Save name</Button>
                {canReset && (
                    <Button variant="secondary" size="sm" disabled={rename.isPending}
                        onClick={() => rename.mutate(null)} data-testid="hub-name-reset">Reset to server name</Button>
                )}
            </div>
        </SettingsSection>
    );
}

/** The settings-sheet section; `null` on a WoW guild. Re-keyed on the name so a refetch resets the draft. */
export function HubNameSection({ ctx }: { ctx: HubCtx }): JSX.Element | null {
    const { guild } = ctx.page;
    if (guild.kind === 'wow_guild') return null;
    return <HubNameForm key={guild.name} page={ctx.page} />;
}
