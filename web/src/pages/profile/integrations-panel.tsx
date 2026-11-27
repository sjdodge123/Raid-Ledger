/**
 * Integrations panel showing Discord and Steam link status (ROK-548).
 * Reuses DiscordLinkCta and SteamSection from identity-sections.
 * ROK-1780: the whole Calendars page renders as a sibling below the
 * Integrations card while the Calendar Sync kill switch is on, whatever the
 * Discord link state (it used to be Profile → Gaming → Calendars).
 * ROK-2371: Google sign-in link/unlink, Discord Unlink and the Link Discord nudge.
 */
import type { JSX } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { useSystemStatus } from '../../hooks/use-system-status';
import { useDiscordLinkAction } from '../../hooks/use-discord-link';
import { useSteamLink } from '../../hooks/use-steam-link';
import { isDiscordLinked, buildDiscordAvatarUrl } from '../../lib/avatar';
import { DiscordLinkCta, SteamSection } from './identity-sections';
import { useSteamRedirectFeedback } from './identity-hooks';
import { useCalendarsSectionShown } from '../../hooks/use-calendar-sync';
import { CalendarsPage } from '../../components/features/calendar-sync/CalendarsPage';
import { CompanionDevicesSection } from './companion-devices-section';
import { GoogleSigninPanel } from './google-panel';
import { DiscordLinkNudge } from './discord-link-nudge';
import { SigninUnlinkButton } from './signin-unlink-button';
import type { SigninMethodsDto, SystemStatusDto } from '@raid-ledger/contract';

/** ROK-2371: the admin allows Google sign-in (it is listed as a login method). */
function isGoogleSigninAvailable(status: SystemStatusDto | undefined): boolean {
    return !!status?.authProviders?.some((p) => p.key === 'google');
}

/** ROK-2371: offer Discord Unlink only where another way in can exist (else it would always be disabled). */
function showDiscordUnlink(methods: SigninMethodsDto | undefined, googleAvailable: boolean): boolean {
    if (!methods) return false;
    return googleAvailable || methods.google !== null || methods.password;
}

/** Discord linked status display */
function DiscordLinkedStatus({ user, unlinkMethods }: {
    user: { username: string; discordId: string | null; avatar: string | null };
    /** ROK-2371: set → render the Unlink control (guarded by the last-method rule). */
    unlinkMethods: SigninMethodsDto | undefined;
}): JSX.Element {
    const avatarUrl = buildDiscordAvatarUrl(user.discordId, user.avatar);
    return (
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-lg bg-success/5 border border-success/20">
            {avatarUrl && (
                <img src={avatarUrl} alt="Discord avatar" className="w-12 h-12 rounded-full border-2 border-success/50"
                    onError={(e) => { e.currentTarget.src = '/default-avatar.svg'; }} />
            )}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{user.username}</p>
                <p className="text-xs text-success">Discord linked</p>
            </div>
            {unlinkMethods && <SigninUnlinkButton method="discord" methods={unlinkMethods} />}
        </div>
    );
}

/** Calendars section — shown while the admin kill switch is on (ROK-1780), or with its load error if the overview failed. */
function CalendarsSection(): JSX.Element | null {
    return useCalendarsSectionShown() ? <CalendarsPage /> : null;
}

/** Discord row: linked (with Unlink where another way in can exist) or the Link CTA + nudge. */
function DiscordSection({ user, googleAvailable }: {
    user: { username: string; discordId: string; avatar: string | null; signinMethods?: SigninMethodsDto | undefined };
    googleAvailable: boolean;
}): JSX.Element {
    const { linkDiscord: handleLinkDiscord, isPending: linkPending } = useDiscordLinkAction();
    const methods = user.signinMethods;
    if (isDiscordLinked(user.discordId)) {
        return <DiscordLinkedStatus user={user}
            unlinkMethods={showDiscordUnlink(methods, googleAvailable) ? methods : undefined} />;
    }
    return (
        <>
            <DiscordLinkNudge methods={methods} />
            <DiscordLinkCta onLink={handleLinkDiscord} pending={linkPending} />
        </>
    );
}

/** Integrations panel with Discord, Google sign-in and Steam, then Companion devices (ROK-1955, the /link "Manage devices" target), then Calendars. */
export function IntegrationsPanel(): JSX.Element | null {
    useSteamRedirectFeedback();
    const { user } = useAuth();
    const { data: systemStatus } = useSystemStatus();
    const { linkSteam, isLinkPending, steamStatus, unlinkSteam, syncLibrary, syncWishlist } = useSteamLink();

    if (!user) return null;
    const googleAvailable = isGoogleSigninAvailable(systemStatus);

    return (
        <div className="space-y-6">
            <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                <h2 className="text-xl font-semibold text-foreground mb-1">Integrations</h2>
                <p className="text-sm text-muted mb-5">Manage your linked accounts and external services.</p>
                {systemStatus?.discordConfigured && <DiscordSection user={user} googleAvailable={googleAvailable} />}
                <div className="mt-4 empty:hidden">
                    <GoogleSigninPanel methods={user.signinMethods} googleAvailable={googleAvailable} />
                </div>
                {systemStatus?.steamConfigured && (
                    <SteamSection steamStatus={steamStatus} linkSteam={linkSteam} linkPending={isLinkPending}
                        unlinkSteam={unlinkSteam} syncLibrary={syncLibrary} syncWishlist={syncWishlist} />
                )}
            </div>
            <CompanionDevicesSection />
            <CalendarsSection />
        </div>
    );
}
