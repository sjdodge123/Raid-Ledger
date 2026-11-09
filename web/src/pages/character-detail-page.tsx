import { useParams, useNavigate } from 'react-router-dom';
import { useCharacterDetail } from '../hooks/use-character-detail';
import { useAuth, isAdmin } from '../hooks/use-auth';
import type { CharacterDto } from '@raid-ledger/contract';
import { PluginSlot } from '../plugins';
import { CharacterHeader } from './character-detail-header';

function CharacterDetailLoading() {
    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            <div className="animate-pulse space-y-4">
                <div className="h-8 w-48 bg-overlay rounded" />
                <div className="h-32 bg-overlay rounded-lg" />
                <div className="h-64 bg-overlay rounded-lg" />
            </div>
        </div>
    );
}

function CharacterDetailError({ message, onBack }: { message: string; onBack: () => void }) {
    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            <div className="bg-danger/10 border border-danger/40 rounded-lg p-6 text-center">
                <p className="text-danger">{message}</p>
                <button onClick={onBack} className="text-blue-400 hover:underline mt-2 inline-block">Go back</button>
            </div>
        </div>
    );
}


function CharacterEquipmentSection({ character, isArmoryImported, isOwner }: { character: CharacterDto; isArmoryImported: boolean; isOwner: boolean }) {
    return (
        <PluginSlot name="character-detail:sections"
            context={{ equipment: character.equipment, talents: character.talents, professions: character.professions, gameVariant: character.gameVariant, renderUrl: character.renderUrl, isArmoryImported, characterClass: character.class ?? null, enrichments: character.enrichments ?? [], isOwner, characterId: character.id, gameId: character.gameId }}
            fallback={character.equipment?.items.length ? null : (
                <div className="bg-panel border border-edge rounded-lg p-6">
                    <h2 className="text-lg font-semibold text-foreground mb-4">Equipment</h2>
                    <div className="text-center py-8 text-muted"><p className="text-lg">No equipment data</p><p className="text-sm mt-1">Equipment data is available for games with plugin support.</p></div>
                </div>
            )} />
    );
}

export function CharacterDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { data: character, isLoading, error } = useCharacterDetail(id);
    const { user } = useAuth();

    if (isLoading) return <CharacterDetailLoading />;
    if (error || !character) return <CharacterDetailError message={error?.message ?? 'Character not found'} onBack={() => navigate(-1)} />;

    const isOwner = !!(user && user.id === character.userId);
    const isArmoryImported = !!character.lastSyncedAt;

    // ROK-2146: the page widens only while a plugin slot renders a non-empty sidebar
    // (the WoW sections slot, a sidebar at >= lg); every other character keeps max-w-5xl.
    return (
        <div className="max-w-5xl has-[[data-sections-column=sidebar]>:not(:empty)]:max-w-7xl mx-auto px-4 py-8 space-y-6">
            <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-foreground transition-colors inline-flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg> Back
            </button>
            <CharacterHeader character={character} isOwner={isOwner} isArmoryImported={isArmoryImported} isAdminViewer={isAdmin(user)} />
            <CharacterEquipmentSection character={character} isArmoryImported={isArmoryImported} isOwner={isOwner} />
        </div>
    );
}
