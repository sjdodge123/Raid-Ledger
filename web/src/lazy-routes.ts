/**
 * Lazy-loaded route components with auto-reload on stale chunk failures.
 * Extracted from App.tsx for file size compliance.
 */
import { lazy } from 'react';
import type { ComponentType } from 'react';

export const CHUNK_RELOAD_KEY = 'chunk-reload-attempted';

function isChunkLoadError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
        msg.includes('dynamically imported module') ||
        msg.includes('failed to fetch') ||
        msg.includes('loading chunk') ||
        msg.includes('loading css chunk')
    );
}

/**
 * Wraps React.lazy() to auto-reload the page on stale chunk import failures.
 * On first failure: sets a sessionStorage flag and reloads.
 * On second failure: throws so the ErrorBoundary can show a fallback.
 */
function lazyWithRetry<
    T extends ComponentType<Record<string, never>>,
>(importFn: () => Promise<{ default: T }>) {
    return lazy(() =>
        importFn().catch((error: unknown) => {
            if (
                isChunkLoadError(error) &&
                !sessionStorage.getItem(CHUNK_RELOAD_KEY)
            ) {
                sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
                window.location.reload();
                return new Promise<{ default: T }>(() => {});
            }
            throw error;
        }),
    );
}

// -- Lazy loaded public pages --
export const JoinPage = lazyWithRetry(() =>
    import('./pages/join-page').then((m) => ({ default: m.JoinPage })),
);
export const InvitePage = lazyWithRetry(() =>
    import('./pages/invite-page').then((m) => ({ default: m.InvitePage })),
);

// -- Lazy loaded pages --
export const CalendarPage = lazyWithRetry(() =>
    import('./pages/calendar-page').then((m) => ({ default: m.CalendarPage })),
);
export const CreateEventPage = lazyWithRetry(() =>
    import('./pages/create-event-page').then((m) => ({ default: m.CreateEventPage })),
);
export const PlanEventPage = lazyWithRetry(() =>
    import('./pages/plan-event-page').then((m) => ({ default: m.PlanEventPage })),
);
export const EditEventPage = lazyWithRetry(() =>
    import('./pages/edit-event-page').then((m) => ({ default: m.EditEventPage })),
);
export const GamesPage = lazyWithRetry(() =>
    import('./pages/games-page').then((m) => ({ default: m.GamesPage })),
);
export const GameDetailPage = lazyWithRetry(() =>
    import('./pages/game-detail-page').then((m) => ({ default: m.GameDetailPage })),
);
export const LineupDetailPage = lazyWithRetry(() =>
    import('./pages/lineup-detail-page').then((m) => ({ default: m.LineupDetailPage })),
);
export const CharacterDetailPage = lazyWithRetry(() =>
    import('./pages/character-detail-page').then((m) => ({ default: m.CharacterDetailPage })),
);
export const PlayersPage = lazyWithRetry(() =>
    import('./pages/players-page').then((m) => ({ default: m.PlayersPage })),
);
export const MyEventsPage = lazyWithRetry(() =>
    import('./pages/my-events-page').then((m) => ({ default: m.MyEventsPage })),
);
export const EventMetricsPage = lazyWithRetry(() =>
    import('./pages/event-metrics-page').then((m) => ({ default: m.EventMetricsPage })),
);
export const UserProfilePage = lazyWithRetry(() =>
    import('./pages/user-profile-page').then((m) => ({ default: m.UserProfilePage })),
);
export const OnboardingWizardPage = lazyWithRetry(() =>
    import('./pages/onboarding-wizard-page').then((m) => ({ default: m.OnboardingWizardPage })),
);

// -- Lazy loaded profile panels --
export const ProfileLayout = lazyWithRetry(() =>
    import('./components/profile/profile-layout').then((m) => ({ default: m.ProfileLayout })),
);
export const PreferencesPanel = lazyWithRetry(() =>
    import('./pages/profile/preferences-panel').then((m) => ({ default: m.PreferencesPanel })),
);
export const NotificationsPanel = lazyWithRetry(() =>
    import('./pages/profile/notifications-panel').then((m) => ({ default: m.NotificationsPanel })),
);
export const ProfileGameTimePanel = lazyWithRetry(() =>
    import('./pages/profile/game-time-panel').then((m) => ({ default: m.ProfileGameTimePanel })),
);
export const CharactersPanel = lazyWithRetry(() =>
    import('./pages/profile/characters-panel').then((m) => ({ default: m.CharactersPanel })),
);
export const WatchedGamesPanel = lazyWithRetry(() =>
    import('./pages/profile/watched-games-panel').then((m) => ({ default: m.WatchedGamesPanel })),
);
export const AvatarPanel = lazyWithRetry(() =>
    import('./pages/profile/avatar-panel').then((m) => ({ default: m.AvatarPanel })),
);
export const IntegrationsPanel = lazyWithRetry(() =>
    import('./pages/profile/integrations-panel').then((m) => ({ default: m.IntegrationsPanel })),
);
export const AccountPanel = lazyWithRetry(() =>
    import('./pages/profile/account-panel').then((m) => ({ default: m.AccountPanel })),
);

// -- Lazy loaded admin panels --
export const AdminSettingsLayout = lazyWithRetry(() =>
    import('./components/admin/admin-settings-layout').then((m) => ({ default: m.AdminSettingsLayout })),
);
export const AdminSetupWizard = lazyWithRetry(() =>
    import('./pages/admin/admin-setup-wizard').then((m) => ({ default: m.AdminSetupWizard })),
);
export const GeneralPanel = lazyWithRetry(() =>
    import('./pages/admin/general-panel').then((m) => ({ default: m.GeneralPanel })),
);
export const RolesPanel = lazyWithRetry(() =>
    import('./pages/admin/roles-panel').then((m) => ({ default: m.RolesPanel })),
);
export const DemoDataPanel = lazyWithRetry(() =>
    import('./pages/admin/demo-data-panel').then((m) => ({ default: m.DemoDataPanel })),
);
export const LineupDefaultsPanel = lazyWithRetry(() =>
    import('./pages/admin/lineup-defaults-panel').then((m) => ({ default: m.LineupDefaultsPanel })),
);
export const IgdbPanel = lazyWithRetry(() =>
    import('./pages/admin/igdb-panel').then((m) => ({ default: m.IgdbPanel })),
);
export const SteamPanel = lazyWithRetry(() =>
    import('./pages/admin/steam-panel').then((m) => ({ default: m.SteamPanel })),
);
export const ItadPanel = lazyWithRetry(() =>
    import('./pages/admin/itad-panel').then((m) => ({ default: m.ItadPanel })),
);
export const PluginsPanel = lazyWithRetry(() =>
    import('./pages/admin/plugins-panel').then((m) => ({ default: m.PluginsPanel })),
);
export const PluginIntegrationPanel = lazyWithRetry(() =>
    import('./pages/admin/plugin-integration-panel').then((m) => ({ default: m.PluginIntegrationPanel })),
);
export const CronJobsPanel = lazyWithRetry(() =>
    import('./pages/admin/cron-jobs-panel').then((m) => ({ default: m.CronJobsPanel })),
);
export const BackupsPanel = lazyWithRetry(() =>
    import('./pages/admin/backups-panel').then((m) => ({ default: m.BackupsPanel })),
);
export const LogsPanel = lazyWithRetry(() =>
    import('./pages/admin/logs-panel').then((m) => ({ default: m.LogsPanel })),
);

// -- Lazy loaded Discord admin pages --
export const DiscordOverviewPage = lazyWithRetry(() =>
    import('./pages/admin/discord-overview-page').then((m) => ({ default: m.DiscordOverviewPage })),
);
export const DiscordAuthPage = lazyWithRetry(() =>
    import('./pages/admin/discord-auth-page').then((m) => ({ default: m.DiscordAuthPage })),
);
export const DiscordConnectionPage = lazyWithRetry(() =>
    import('./pages/admin/discord-connection-page').then((m) => ({ default: m.DiscordConnectionPage })),
);
export const DiscordChannelsPage = lazyWithRetry(() =>
    import('./pages/admin/discord-channels-page').then((m) => ({ default: m.DiscordChannelsPage })),
);
export const DiscordFeaturesPage = lazyWithRetry(() =>
    import('./pages/admin/discord-features-page').then((m) => ({ default: m.DiscordFeaturesPage })),
);
