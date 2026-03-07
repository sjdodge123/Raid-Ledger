import type { JSX } from 'react';
import type { InviteCodeResolveResponseDto } from '@raid-ledger/contract';
import { StepIndicator } from './invite-components';
import { DISCORD_ICON, CHECK_ICON } from './invite-constants';

export { CharacterStep } from './invite-character-step';
export type { CharacterStepProps } from './invite-character-step';

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
    discordInviteUrl: string | null | undefined;
    discordJoinLabel: string;
    discordJoinClicked: boolean;
    onDiscordJoinClick: () => void;
    onContinue: () => void;
}

function SuccessCardContent({ event, showDiscordCta, discordInviteUrl, discordJoinLabel, discordJoinClicked, onDiscordJoinClick, onContinue }: {
    event: InviteCodeResolveResponseDto['event']; showDiscordCta: boolean;
    discordInviteUrl: string | null | undefined; discordJoinLabel: string;
    discordJoinClicked: boolean; onDiscordJoinClick: () => void; onContinue: () => void;
}): JSX.Element {
    return (
        <div className="rounded-xl border border-edge bg-surface p-6 text-center shadow-lg">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">{CHECK_ICON}</div>
            <h1 className="text-xl font-bold text-foreground mb-2">You're all set!</h1>
            <p className="text-sm text-foreground font-medium mb-1">{event?.title}</p>
            {event?.startTime && (
                <p className="text-sm text-muted mb-4">
                    {new Date(event.startTime).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}{' '}
                    at {new Date(event.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </p>
            )}
            <p className="text-xs text-muted mb-6">You'll receive a Discord DM with event details shortly.</p>
            {showDiscordCta && <DiscordJoinCta discordInviteUrl={discordInviteUrl!} discordJoinLabel={discordJoinLabel} discordJoinClicked={discordJoinClicked} onDiscordJoinClick={onDiscordJoinClick} />}
            <p className="text-center mt-4">
                <button onClick={onContinue} className={`${showDiscordCta ? 'text-xs' : 'text-sm'} text-muted hover:text-foreground transition-colors underline`}>
                    Continue to set up my Raid Ledger account &rarr;
                </button>
            </p>
        </div>
    );
}

/** Step 3: Success + Discord CTA */
export function SuccessStep({
    stepLabels, totalSteps, event, discordInviteUrl,
    discordJoinLabel, discordJoinClicked, onDiscordJoinClick, onContinue,
}: SuccessStepProps): JSX.Element {
    const showDiscordCta = !!discordInviteUrl;
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 pt-8">
            <div className="w-full max-w-md">
                <StepIndicator labels={stepLabels} current={showDiscordCta ? 4 : 3} total={totalSteps} />
                <SuccessCardContent event={event} showDiscordCta={showDiscordCta} discordInviteUrl={discordInviteUrl}
                    discordJoinLabel={discordJoinLabel} discordJoinClicked={discordJoinClicked}
                    onDiscordJoinClick={onDiscordJoinClick} onContinue={onContinue} />
            </div>
        </div>
    );
}

function DiscordJoinButton({ discordInviteUrl, discordJoinLabel, onDiscordJoinClick }: { discordInviteUrl: string; discordJoinLabel: string; onDiscordJoinClick: () => void }) {
    return (
        <a href={discordInviteUrl} target="_blank" rel="noopener noreferrer" onClick={onDiscordJoinClick} className="btn btn-primary w-full flex items-center justify-center gap-2">
            {DISCORD_ICON} {discordJoinLabel}
        </a>
    );
}

function DiscordJoinConfirmed() {
    return (
        <div className="p-3 rounded-lg bg-emerald-600/10 border border-emerald-500/30 flex items-center justify-center gap-2 text-sm text-emerald-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            Discord invite opened
        </div>
    );
}

/** Discord join CTA block */
function DiscordJoinCta({ discordInviteUrl, discordJoinLabel, discordJoinClicked, onDiscordJoinClick }: {
    discordInviteUrl: string; discordJoinLabel: string; discordJoinClicked: boolean; onDiscordJoinClick: () => void;
}): JSX.Element {
    return (
        <div className="mb-4 p-4 rounded-lg bg-[#5865F2]/10 border border-[#5865F2]/30">
            <p className="text-sm text-muted mb-3">One more thing -- join the Discord server for voice comms and team chat:</p>
            {!discordJoinClicked ? <DiscordJoinButton discordInviteUrl={discordInviteUrl} discordJoinLabel={discordJoinLabel} onDiscordJoinClick={onDiscordJoinClick} /> : <DiscordJoinConfirmed />}
        </div>
    );
}
