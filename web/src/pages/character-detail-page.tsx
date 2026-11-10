import type { JSX } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, isAdmin } from '../hooks/use-auth';
import type { CharacterDto } from '@raid-ledger/contract';
import { PluginSlot } from '../plugins';
import { CharacterHeader } from './character-detail-header';
import { CharacterDetailError, CharacterDetailLoading } from './character-detail-states';
import { useCharacterPageSource, type ReadOnlyCharacterMeta } from './character-detail-source';

interface SectionProps { character: CharacterDto; isArmoryImported: boolean; isOwner: boolean; readOnly: ReadOnlyCharacterMeta | null }

/** ROK-2149: read-only mode tells the plugin so it renders from the payload and skips character-id-keyed panels. */
function readOnlyContext(character: CharacterDto, readOnly: ReadOnlyCharacterMeta | null): Record<string, unknown> {
    return readOnly ? { readOnlyCharacter: character, noArmoryReason: readOnly.noArmoryReason } : {};
}

function CharacterEquipmentSection({ character, isArmoryImported, isOwner, readOnly }: SectionProps) {
    return (
        <PluginSlot name="character-detail:sections"
            context={{ equipment: character.equipment, talents: character.talents, professions: character.professions, gameVariant: character.gameVariant, renderUrl: character.renderUrl, isArmoryImported, characterClass: character.class ?? null, enrichments: character.enrichments ?? [], isOwner, characterId: character.id, gameId: character.gameId, ...readOnlyContext(character, readOnly) }}
            fallback={character.equipment?.items.length ? null : (
                <div className="bg-panel border border-edge rounded-lg p-6">
                    <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
                    <div className="text-center py-8 text-muted"><p className="text-lg">No equipment data</p><p className="text-sm mt-1">Equipment data is available for games with plugin support.</p></div>
                </div>
            )} />
    );
}

/**
 * One page for a character (`/characters/:id`) and, ROK-2149, for a hub roster
 * member with no character (`/hubs/:id/members/:memberId`), shown read-only:
 * no owner/admin actions and no slot keyed by character id.
 */
export function CharacterDetailPage(): JSX.Element {
    const source = useCharacterPageSource();
    const navigate = useNavigate();
    const { user } = useAuth();

    if (source.kind === 'loading') return <CharacterDetailLoading />;
    if (source.kind === 'redirect') return <Navigate replace to={source.to} />;
    if (source.kind === 'error') return <CharacterDetailError message={source.message} status={source.status} hubId={source.hubId} onBack={() => navigate(-1)} />;

    const { character, readOnly } = source;
    const isOwner = !readOnly && !!(user && user.id === character.userId);
    const isArmoryImported = !!character.lastSyncedAt;

    // ROK-2146: the page widens only while a plugin slot renders a non-empty sidebar
    // (the WoW sections slot, a sidebar at >= lg); every other character keeps max-w-5xl.
    return (
        <div className="max-w-5xl has-[[data-sections-column=sidebar]>:not(:empty)]:max-w-7xl mx-auto px-4 py-8 space-y-6">
            <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg> Back
            </button>
            <CharacterHeader character={character} isOwner={isOwner} isArmoryImported={isArmoryImported} isAdminViewer={!readOnly && isAdmin(user)} readOnly={readOnly} />
            <CharacterEquipmentSection character={character} isArmoryImported={isArmoryImported} isOwner={isOwner} readOnly={readOnly} />
        </div>
    );
}
