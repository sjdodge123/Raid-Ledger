import type { CharacterDto, InviteCodeResolveResponseDto, PugRole } from '@raid-ledger/contract';
import { formatRole } from '../../lib/role-colors';
import { WowArmoryImportForm } from '../../plugins/wow/components/wow-armory-import-form';
import { StepIndicator, CharacterCard, DISCORD_ICON, CHECK_ICON } from './invite-components';

interface EventHeaderProps {
    event: InviteCodeResolveResponseDto['event'];
}

/** Shared event header displayed across all steps */
export function EventHeader({ event }: EventHeaderProps): JSX.Element {
    return (
        <div className="text-center mb-4">
            {event?.game?.coverUrl && (
                <img
                    src={event.game.coverUrl}
                    alt={event.game.name}
                    className="mx-auto mb-3 h-16 w-16 rounded-lg object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
            )}
            <p className="text-xs uppercase tracking-wide text-muted mb-1">You have been invited to</p>
            <h1 className="text-xl font-bold text-foreground mb-0.5">{event?.title ?? 'Event'}</h1>
            {event?.game && <p className="text-sm text-muted mb-1">{event.game.name}</p>}
            {event?.startTime && (
                <p className="text-sm text-muted">
                    {new Date(event.startTime).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}{' '}
                    at {new Date(event.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </p>
            )}
        </div>
    );
}

interface AuthStepProps {
    stepLabels: string[];
    totalSteps: number;
    eventHeader: JSX.Element;
    event: InviteCodeResolveResponseDto['event'];
    onLogin: () => void;
    onViewEvent: () => void;
}

/** Step 1: Authenticate */
export function AuthStep({ stepLabels, totalSteps, eventHeader, event, onLogin, onViewEvent }: AuthStepProps): JSX.Element {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 pt-8">
            <div className="w-full max-w-md">
                <StepIndicator labels={stepLabels} current={1} total={totalSteps} />
                <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
                    {eventHeader}
                    <div className="mt-6 space-y-3">
                        <button onClick={onLogin} className="btn btn-primary w-full flex items-center justify-center gap-2">
                            {DISCORD_ICON}
                            Sign in with Discord to Join
                        </button>
                        {event && (
                            <button onClick={onViewEvent} className="btn btn-secondary w-full">
                                View Event Details
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

interface SuccessStepProps {
    stepLabels: string[];
    totalSteps: number;
    event: InviteCodeResolveResponseDto['event'];
    discordInviteUrl: string | undefined;
    discordJoinLabel: string;
    discordJoinClicked: boolean;
    onDiscordJoinClick: () => void;
    onContinue: () => void;
}

/** Step 3: Success + Discord CTA */
// eslint-disable-next-line max-lines-per-function
export function SuccessStep({
    stepLabels, totalSteps, event, discordInviteUrl,
    discordJoinLabel, discordJoinClicked, onDiscordJoinClick, onContinue,
}: SuccessStepProps): JSX.Element {
    const showDiscordCta = !!discordInviteUrl;
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 pt-8">
            <div className="w-full max-w-md">
                <StepIndicator labels={stepLabels} current={showDiscordCta ? 4 : 3} total={totalSteps} />
                <div className="rounded-xl border border-edge bg-surface p-6 text-center shadow-lg">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        {CHECK_ICON}
                    </div>
                    <h1 className="text-xl font-bold text-foreground mb-2">You're all set!</h1>
                    <p className="text-sm text-foreground font-medium mb-1">{event?.title}</p>
                    {event?.startTime && (
                        <p className="text-sm text-muted mb-4">
                            {new Date(event.startTime).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}{' '}
                            at {new Date(event.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </p>
                    )}
                    <p className="text-xs text-muted mb-6">You'll receive a Discord DM with event details shortly.</p>

                    {showDiscordCta && (
                        <DiscordJoinCta
                            discordInviteUrl={discordInviteUrl!}
                            discordJoinLabel={discordJoinLabel}
                            discordJoinClicked={discordJoinClicked}
                            onDiscordJoinClick={onDiscordJoinClick}
                        />
                    )}

                    <p className="text-center mt-4">
                        <button
                            onClick={onContinue}
                            className={`${showDiscordCta ? 'text-xs' : 'text-sm'} text-muted hover:text-foreground transition-colors underline`}
                        >
                            Continue to set up my Raid Ledger account &rarr;
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}

/** Discord join CTA block */
function DiscordJoinCta({
    discordInviteUrl, discordJoinLabel, discordJoinClicked, onDiscordJoinClick,
}: {
    discordInviteUrl: string;
    discordJoinLabel: string;
    discordJoinClicked: boolean;
    onDiscordJoinClick: () => void;
}): JSX.Element {
    return (
        <div className="mb-4 p-4 rounded-lg bg-[#5865F2]/10 border border-[#5865F2]/30">
            <p className="text-sm text-muted mb-3">
                One more thing -- join the Discord server for voice comms and team chat:
            </p>
            {!discordJoinClicked ? (
                <a
                    href={discordInviteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onDiscordJoinClick}
                    className="btn btn-primary w-full flex items-center justify-center gap-2"
                >
                    {DISCORD_ICON}
                    {discordJoinLabel}
                </a>
            ) : (
                <div className="p-3 rounded-lg bg-emerald-600/10 border border-emerald-500/30 flex items-center justify-center gap-2 text-sm text-emerald-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Discord invite opened
                </div>
            )}
        </div>
    );
}

interface CharacterStepProps {
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

/** Step 2: Character / Role + Join */
// eslint-disable-next-line max-lines-per-function
export function CharacterStep({
    stepLabels, totalSteps, eventHeader, hasRoles,
    shouldShowCharacterSelector, shouldShowImportForm,
    characters, selectedCharacterId, selectedRole, characterRole,
    isClaiming, gameInfo,
    onSelectCharacter, onSelectRole, onClaim,
    onShowImportForm, onShowManualRoleSelector, onImportSuccess,
}: CharacterStepProps): JSX.Element {
    const requiresRole = hasRoles && !shouldShowImportForm && !shouldShowCharacterSelector;

    if (!hasRoles) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 pt-8">
                <div className="w-full max-w-md">
                    <StepIndicator labels={stepLabels} current={2} total={totalSteps} />
                    <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
                        {eventHeader}
                        <div className="mt-4">
                            <p className="text-sm text-muted mb-4 text-center">Ready to join this event?</p>
                            <button onClick={() => onClaim()} disabled={isClaiming} className="btn btn-primary w-full">
                                {isClaiming ? 'Joining...' : 'Join Event'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 pt-8">
            <div className="w-full max-w-md">
                <StepIndicator labels={stepLabels} current={2} total={totalSteps} />
                <div className="rounded-xl border border-edge bg-surface p-6 shadow-lg">
                    {eventHeader}

                    {shouldShowCharacterSelector && (
                        <CharacterSelector
                            characters={characters}
                            selectedCharacterId={selectedCharacterId}
                            selectedRole={selectedRole}
                            characterRole={characterRole}
                            isClaiming={isClaiming}
                            onSelectCharacter={onSelectCharacter}
                            onSelectRole={onSelectRole}
                            onClaim={onClaim}
                            onShowImportForm={onShowImportForm}
                        />
                    )}

                    {shouldShowImportForm && (
                        <div className="mt-4 text-left">
                            <p className="text-sm text-muted mb-3 text-center">Import your character to auto-detect your role</p>
                            <WowArmoryImportForm
                                gameVariant={gameInfo?.gameVariant}
                                defaultRealm={gameInfo?.inviterRealm}
                                onSuccess={onImportSuccess}
                                isMain
                            />
                            <button type="button" onClick={onShowManualRoleSelector} className="mt-3 w-full text-xs text-muted hover:text-foreground transition-colors">
                                Skip, choose role manually
                            </button>
                        </div>
                    )}

                    {!shouldShowImportForm && !shouldShowCharacterSelector && (
                        <ManualRoleSelector
                            selectedRole={selectedRole}
                            isClaiming={isClaiming}
                            requiresRole={requiresRole}
                            onSelectRole={onSelectRole}
                            onClaim={onClaim}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

/** Character selector with role picker */
// eslint-disable-next-line max-lines-per-function
function CharacterSelector({
    characters, selectedCharacterId, selectedRole, characterRole,
    isClaiming, onSelectCharacter, onSelectRole, onClaim, onShowImportForm,
}: {
    characters: CharacterDto[];
    selectedCharacterId: string | null;
    selectedRole: PugRole | null;
    characterRole: PugRole | null;
    isClaiming: boolean;
    onSelectCharacter: (charId: string, role: PugRole | null) => void;
    onSelectRole: (role: PugRole) => void;
    onClaim: (role?: PugRole, charId?: string) => void;
    onShowImportForm: () => void;
}): JSX.Element {
    return (
        <div className="mt-4">
            <p className="text-sm text-muted mb-3 text-center">Select a character for this event</p>
            <div className="space-y-2 mb-4">
                {characters.map((char) => (
                    <CharacterCard
                        key={char.id}
                        character={char}
                        isSelected={selectedCharacterId === char.id}
                        onSelect={() => {
                            const role = (char.effectiveRole ?? char.roleOverride ?? char.role) as PugRole | null;
                            onSelectCharacter(char.id, role);
                        }}
                    />
                ))}
            </div>

            {selectedCharacterId && (
                <RolePicker selectedRole={selectedRole} onSelectRole={onSelectRole} label="Confirm your role" />
            )}

            <button
                onClick={() => onClaim(selectedRole ?? characterRole ?? undefined)}
                disabled={isClaiming || !selectedCharacterId || !selectedRole}
                className="btn btn-primary w-full mb-2"
            >
                {isClaiming ? 'Joining...' : 'Join Event'}
            </button>
            <button type="button" onClick={onShowImportForm} className="w-full text-xs text-muted hover:text-foreground transition-colors">
                Import another character
            </button>
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
