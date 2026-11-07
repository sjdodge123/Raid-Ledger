/**
 * ROK-1928 A4 — "Blizzard roster" in a WoW: Forever guild hub's settings
 * sheet (`HubModule.settingsSections`): the Blizzard guild slug (editable
 * with `canEdit`, prefilled with a suggestion), Save, "Sync now" once a slug
 * is set, and the last sync's status line (D2). Hidden on every other hub.
 */
import { useState, type JSX } from 'react';
import type { GuildBlizzardRosterView } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { SettingsSection } from '../../../components/hub/settings/settings-rows';
import { toast } from '../../../lib/toast';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { useGuildBlizzardRoster, useSetBlizzardRosterSlug, useSyncBlizzardRoster } from '../hooks/use-guild-blizzard-roster';
import { blizzardRosterStatusLine } from './blizzard-roster-status';

const BLURB = 'Read the member list from Blizzard instead of LedgerLink exports.';

/** The hub's settings-sheet section; renders nothing off a Forever guild hub. */
export function BlizzardRosterSection({ page }: HubCtx): JSX.Element | null {
    const { guild, viewer } = page;
    const forever = guild.kind === 'wow_guild' && guild.gameSlug === WOW_FOREVER_GAME_SLUG;
    const query = useGuildBlizzardRoster(guild.id, forever);
    if (!forever || query.data === undefined) return null;
    return (
        <SettingsSection title="Blizzard roster" blurb={BLURB} testId="wow-blizzard-roster-section">
            <StatusLine roster={query.data} />
            {viewer.canEdit
                ? <SlugEditor guildId={guild.id} roster={query.data} />
                : <SlugReadout slug={query.data.guildSlug} />}
        </SettingsSection>
    );
}

function StatusLine({ roster }: { roster: GuildBlizzardRosterView }): JSX.Element | null {
    const line = blizzardRosterStatusLine(roster);
    if (line === null) return null;
    const tone = roster.status === 'ok' ? 'text-secondary' : 'text-warning';
    return <p className={`text-sm ${tone}`} data-testid="wow-blizzard-roster-status">{line}</p>;
}

function SlugReadout({ slug }: { slug: string | null }): JSX.Element {
    return (
        <p className="text-sm text-secondary" data-testid="wow-blizzard-roster-slug">
            {slug === null ? 'No Blizzard guild set — the roster comes from LedgerLink.' : `Blizzard guild: ${slug}`}
        </p>
    );
}

function SlugEditor({ guildId, roster }: { guildId: number; roster: GuildBlizzardRosterView }): JSX.Element {
    const [draft, setDraft] = useState(roster.guildSlug ?? roster.suggestedSlug);
    const save = useSetBlizzardRosterSlug(guildId);
    const sync = useSyncBlizzardRoster(guildId);
    const onSave = (): void => {
        const slug = draft.trim();
        save.mutate(slug === '' ? null : slug, { onError: () => toast.error("Couldn't save the Blizzard guild.") });
    };
    const onSync = (): void => sync.mutate(undefined, { onError: () => toast.error("Couldn't sync the roster from Blizzard.") });
    return (
        <>
            <Field label="Blizzard guild slug" hint="As in the guild's Armory address, e.g. ye-olde-guild. Clear it to stop syncing.">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="wow-blizzard-roster-input" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onSave} disabled={save.isPending} data-testid="wow-blizzard-roster-save">Save</Button>
                {roster.guildSlug !== null && (
                    <Button variant="secondary" size="sm" onClick={onSync} disabled={sync.isPending} data-testid="wow-blizzard-roster-sync">
                        {sync.isPending ? 'Syncing…' : 'Sync now'}
                    </Button>
                )}
            </div>
        </>
    );
}
