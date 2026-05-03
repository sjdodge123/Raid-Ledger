/**
 * Application route tree extracted from App.tsx.
 * All lazy-loaded components are imported from lazy-routes.ts.
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/auth';
import { RootRedirect } from './components/RootRedirect';
import { EventsPage } from './pages/events-page';
import { EventDetailPage } from './pages/event-detail-page';
import { AuthSuccessPage } from './pages/auth-success-page';

import {
  JoinPage, InvitePage,
  CalendarPage, CreateEventPage, PlanEventPage, EditEventPage,
  GamesPage, GameDetailPage, LineupDetailPage, SchedulingPollPage, CharacterDetailPage,
  PlayersPage, EventMetricsPage,
  InsightsHubPage, InsightsCommunityTab, InsightsEventsTab,
  UserProfilePage, OnboardingWizardPage,
  ProfileLayout, PreferencesPanel,
  NotificationsPanel, ProfileGameTimePanel,
  CharactersPanel, WatchedGamesPanel,
  AvatarPanel, IntegrationsPanel, AccountPanel,
  AdminSettingsLayout, AdminSetupWizard,
  GeneralPanel, RolesPanel, DemoDataPanel,
  IgdbPanel, SteamPanel, ItadPanel, PluginsPanel, PluginIntegrationPanel,
  CronJobsPanel, BackupsPanel, LogsPanel,
  DiscordOverviewPage, DiscordAuthPage,
  DiscordConnectionPage, DiscordChannelsPage,
  DiscordFeaturesPage,
  LineupWireframesRoute, LineupWireframesIndexRoute,
} from './lazy-routes';

function ProfileRoutes() {
  return (
    <Route path="/profile" element={<ProfileLayout />}>
      <Route path="avatar" element={<AvatarPanel />} />
      <Route path="integrations" element={<IntegrationsPanel />} />
      <Route path="preferences" element={<PreferencesPanel />} />
      <Route path="notifications" element={<NotificationsPanel />} />
      <Route path="gaming/game-time" element={<ProfileGameTimePanel />} />
      <Route path="gaming/characters" element={<CharactersPanel />} />
      <Route path="gaming/watched-games" element={<WatchedGamesPanel />} />
      <Route path="account" element={<AccountPanel />} />
      {/* backward-compat redirects (ROK-548) */}
      <Route path="identity" element={<Navigate to="/profile/avatar" replace />} />
      <Route path="identity/discord" element={<Navigate to="/profile/integrations" replace />} />
      <Route path="identity/avatar" element={<Navigate to="/profile/avatar" replace />} />
      <Route path="preferences/appearance" element={<Navigate to="/profile/preferences" replace />} />
      <Route path="preferences/timezone" element={<Navigate to="/profile/preferences" replace />} />
      <Route path="preferences/notifications" element={<Navigate to="/profile/notifications" replace />} />
      <Route path="gaming" element={<Navigate to="/profile/gaming/game-time" replace />} />
      <Route path="danger/delete-account" element={<Navigate to="/profile/account" replace />} />
    </Route>
  );
}

function AdminSettingsRoutes() {
  return (
    <Route path="/admin/settings" element={<AdminSettingsLayout />}>
      <Route path="general" element={<GeneralPanel />} />
      <Route path="general/roles" element={<RolesPanel />} />
      <Route path="general/data" element={<DemoDataPanel />} />
      <Route path="general/lineup" element={<Navigate to="/admin/settings/general" replace />} />
      <Route path="general/cron-jobs" element={<CronJobsPanel />} />
      <Route path="general/backups" element={<BackupsPanel />} />
      <Route path="general/logs" element={<LogsPanel />} />
      <Route path="integrations/igdb" element={<IgdbPanel />} />
      <Route path="integrations/steam" element={<SteamPanel />} />
      <Route path="integrations/itad" element={<ItadPanel />} />
      <Route path="discord" element={<DiscordOverviewPage />} />
      <Route path="discord/auth" element={<DiscordAuthPage />} />
      <Route path="discord/connection" element={<DiscordConnectionPage />} />
      <Route path="discord/channels" element={<DiscordChannelsPage />} />
      <Route path="discord/features" element={<DiscordFeaturesPage />} />
      <Route path="integrations" element={<Navigate to="/admin/settings/discord" replace />} />
      <Route path="integrations/discord" element={<Navigate to="/admin/settings/discord" replace />} />
      <Route path="integrations/discord-bot" element={<Navigate to="/admin/settings/discord/connection" replace />} />
      <Route path="integrations/channel-bindings" element={<Navigate to="/admin/settings/discord/channels" replace />} />
      <Route path="integrations/plugin/discord/*" element={<Navigate to="/admin/settings/discord" replace />} />
      <Route path="integrations/plugin/:pluginSlug/:integrationKey" element={<PluginIntegrationPanel />} />
      <Route path="plugins" element={<PluginsPanel />} />
      <Route path="appearance" element={<Navigate to="/admin/settings/general" replace />} />
    </Route>
  );
}

/**
 * ROK-1193 spike — lineup UX wireframes (DEMO_MODE-gated).
 * Component redirects to / when demoMode is false.
 */
function DevWireframeRoutes() {
  return (
    <>
      <Route path="/dev/wireframes/lineup" element={<LineupWireframesIndexRoute />} />
      <Route path="/dev/wireframes/lineup/:page/:persona/:state" element={<LineupWireframesRoute />} />
    </>
  );
}

/** All application routes */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/auth/success" element={<AuthSuccessPage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/i/:code" element={<InvitePage />} />

      <Route element={<AuthGuard />}>
        <Route path="/onboarding" element={<OnboardingWizardPage />} />
        <Route path="/admin/setup" element={<AdminSetupWizard />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/:id" element={<GameDetailPage />} />
        <Route path="/community-lineup/:id" element={<LineupDetailPage />} />
        <Route path="/community-lineup/:lineupId/schedule/:matchId" element={<SchedulingPollPage />} />
        <Route path="/characters/:id" element={<CharacterDetailPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/event-metrics" element={<Navigate to="/insights/events" replace />} />
        <Route path="/insights" element={<InsightsHubPage />}>
          <Route index element={<Navigate to="/insights/community" replace />} />
          <Route path="community" element={<InsightsCommunityTab />} />
          <Route path="events" element={<InsightsEventsTab />} />
        </Route>
        <Route path="/events/new" element={<CreateEventPage />} />
        <Route path="/events/plan" element={<PlanEventPage />} />
        <Route path="/events/:id/metrics" element={<EventMetricsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/events/:id/edit" element={<EditEventPage />} />
        <Route path="/users/:userId" element={<UserProfilePage />} />
        {DevWireframeRoutes()}
        {ProfileRoutes()}
        {AdminSettingsRoutes()}
      </Route>
    </Routes>
  );
}
