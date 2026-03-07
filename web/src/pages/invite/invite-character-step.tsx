import type { JSX } from 'react';
import type { CharacterDto, PugRole } from '@raid-ledger/contract';
import { formatRole } from '../../lib/role-colors';
import { WowArmoryImportForm } from '../../plugins/wow/components/wow-armory-import-form';
import { StepIndicator, CharacterCard } from './invite-components';

export interface CharacterStepProps {
    stepLabels: string[];
    totalSteps: number;
    eventHeader: JSX.Element;
    hasRoles: boolean;
    shouldShowCharacterSelector: boolean;
    shouldShowImportForm: boolean;
    characters: CharacterDto[];
    selectedCharacterId: string | null;
    selectedRole: PugRole | null;
    characterRole: PugRole | null;
    isClaiming: boolean;
    gameInfo: { gameVariant?: string; inviterRealm?: string } | undefined;
    onSelectCharacter: (charId: string, role: PugRole | null) => void;
    onSelectRole: (role: PugRole) => void;
    onClaim: (role?: PugRole, charId?: string) => void;
    onShowImportForm: () => void;
    onShowManualRoleSelector: () => void;
    onImportSuccess: () => void;
}

function SimpleJoinCard({ eventHeader, isClaiming, onClaim }: { eventHeader: JSX.Element; isClaiming: boolean; onClaim: () => void }) {
    return (
        <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
            {eventHeader}
            <div className="mt-4">
                <p className="text-sm text-muted mb-4 text-center">Ready to join this event?</p>
                <button onClick={onClaim} disabled={isClaiming} className="btn btn-primary w-full">
                    {isClaiming ? 'Joining...' : 'Join Event'}
                </button>
            </div>
        </div>
    );
}

function ImportFormSection({ gameInfo, onImportSuccess, onShowManualRoleSelector }: {
    gameInfo: CharacterStepProps['gameInfo']; onImportSuccess: () => void; onShowManualRoleSelector: () => void;
}) {
    return (
        <div className="mt-4 text-left">
            <p className="text-sm text-muted mb-3 text-center">Import your character to auto-detect your role</p>
            <WowArmoryImportForm gameVariant={gameInfo?.gameVariant} defaultRealm={gameInfo?.inviterRealm} onSuccess={onImportSuccess} isMain />
            <button type="button" onClick={onShowManualRoleSelector} className="mt-3 w-full text-xs text-muted hover:text-foreground transition-colors">
                Skip, choose role manually
            </button>
        </div>
    );
}

/** Step 2: Character / Role + Join */
export function CharacterStep(props: CharacterStepProps): JSX.Element {
    const { stepLabels, totalSteps, eventHeader, hasRoles } = props;
    if (!hasRoles) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 pt-8">
                <div className="w-full max-w-md">
                    <StepIndicator labels={stepLabels} current={2} total={totalSteps} />
                    <SimpleJoinCard eventHeader={eventHeader} isClaiming={props.isClaiming} onClaim={() => props.onClaim()} />
                </div>
            </div>
        );
    }
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 pt-8">
            <div className="w-full max-w-md">
                <StepIndicator labels={stepLabels} current={2} total={totalSteps} />
                <CharacterStepCard {...props} />
            </div>
        </div>
    );
}

function CharacterStepCard(props: CharacterStepProps): JSX.Element {
    const requiresRole = props.hasRoles && !props.shouldShowImportForm && !props.shouldShowCharacterSelector;
    return (
        <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
            {props.eventHeader}
            {props.shouldShowCharacterSelector && (
                <CharacterSelector characters={props.characters} selectedCharacterId={props.selectedCharacterId}
                    selectedRole={props.selectedRole} characterRole={props.characterRole} isClaiming={props.isClaiming}
                    onSelectCharacter={props.onSelectCharacter} onSelectRole={props.onSelectRole}
                    onClaim={props.onClaim} onShowImportForm={props.onShowImportForm} />
            )}
            {props.shouldShowImportForm && (
                <ImportFormSection gameInfo={props.gameInfo} onImportSuccess={props.onImportSuccess} onShowManualRoleSelector={props.onShowManualRoleSelector} />
            )}
            {!props.shouldShowImportForm && !props.shouldShowCharacterSelector && (
                <ManualRoleSelector selectedRole={props.selectedRole} isClaiming={props.isClaiming}
                    requiresRole={requiresRole} onSelectRole={props.onSelectRole} onClaim={props.onClaim} />
            )}
        </div>
    );
}

function CharacterList({ characters, selectedCharacterId, onSelectCharacter }: {
    characters: CharacterDto[]; selectedCharacterId: string | null;
    onSelectCharacter: (charId: string, role: PugRole | null) => void;
}) {
    return (
        <div className="space-y-2 mb-4">
            {characters.map((char) => (
                <CharacterCard key={char.id} character={char} isSelected={selectedCharacterId === char.id}
                    onSelect={() => {
                        const role = (char.effectiveRole ?? char.roleOverride ?? char.role) as PugRole | null;
                        onSelectCharacter(char.id, role);
                    }} />
            ))}
        </div>
    );
}

/** Character selector with role picker */
function CharacterSelector({
    characters, selectedCharacterId, selectedRole, characterRole,
    isClaiming, onSelectCharacter, onSelectRole, onClaim, onShowImportForm,
}: {
    characters: CharacterDto[]; selectedCharacterId: string | null;
    selectedRole: PugRole | null; characterRole: PugRole | null; isClaiming: boolean;
    onSelectCharacter: (charId: string, role: PugRole | null) => void;
    onSelectRole: (role: PugRole) => void;
    onClaim: (role?: PugRole, charId?: string) => void;
    onShowImportForm: () => void;
}): JSX.Element {
    return (
        <div className="mt-4">
            <p className="text-sm text-muted mb-3 text-center">Select a character for this event</p>
            <CharacterList characters={characters} selectedCharacterId={selectedCharacterId} onSelectCharacter={onSelectCharacter} />
            {selectedCharacterId && <RolePicker selectedRole={selectedRole} onSelectRole={onSelectRole} label="Confirm your role" />}
            <button onClick={() => onClaim(selectedRole ?? characterRole ?? undefined)} disabled={isClaiming || !selectedCharacterId || !selectedRole} className="btn btn-primary w-full mb-2">
                {isClaiming ? 'Joining...' : 'Join Event'}
            </button>
            <button type="button" onClick={onShowImportForm} className="w-full text-xs text-muted hover:text-foreground transition-colors">Import another character</button>
        </div>
    );
}

/** Manual role selection with join button */
function ManualRoleSelector({
    selectedRole, isClaiming, requiresRole, onSelectRole, onClaim,
}: {
    selectedRole: PugRole | null;
    isClaiming: boolean;
    requiresRole: boolean;
    onSelectRole: (role: PugRole) => void;
    onClaim: (role?: PugRole) => void;
}): JSX.Element {
    return (
        <div className="mt-4">
            <RolePicker selectedRole={selectedRole} onSelectRole={onSelectRole} label="Select your role for this event" />
            <button
                onClick={() => onClaim()}
                disabled={isClaiming || (requiresRole && !selectedRole)}
                className="btn btn-primary w-full"
            >
                {isClaiming ? 'Joining...' : 'Join Event'}
            </button>
        </div>
    );
}

/** Shared role picker (tank/healer/dps buttons) */
function RolePicker({ selectedRole, onSelectRole, label }: {
    selectedRole: PugRole | null;
    onSelectRole: (role: PugRole) => void;
    label: string;
}): JSX.Element {
    return (
        <div className="mb-4">
            <p className="text-xs text-muted mb-2 text-center">{label}</p>
            <div className="flex justify-center gap-2">
                {(['tank', 'healer', 'dps'] as const).map((role) => (
                    <button
                        key={role}
                        type="button"
                        onClick={() => onSelectRole(role)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                            selectedRole === role
                                ? 'bg-emerald-600 text-white border-emerald-500'
                                : 'bg-panel text-muted border-edge hover:border-foreground/30'
                        }`}
                    >
                        {formatRole(role)}
                    </button>
                ))}
            </div>
        </div>
    );
}
