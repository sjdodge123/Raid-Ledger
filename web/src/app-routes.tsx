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
  GamesPage, GameDetailPage, CharacterDetailPage,
  PlayersPage, MyEventsPage, EventMetricsPage,
  UserProfilePage, OnboardingWizardPage,
  ProfileLayout, IdentityPanel, PreferencesPanel,
  NotificationsPanel, ProfileGameTimePanel,
  CharactersPanel, WatchedGamesPanel,
  AdminSettingsLayout, AdminSetupWizard,
  GeneralPanel, RolesPanel, DemoDataPanel,
  IgdbPanel, PluginsPanel, PluginIntegrationPanel,
  CronJobsPanel, BackupsPanel, LogsPanel,
  DiscordOverviewPage, DiscordAuthPage,
  DiscordConnectionPage, DiscordChannelsPage,
  DiscordFeaturesPage,
} from './lazy-routes';

function ProfileRoutes() {
  return (
    <Route path="/profile" element={<ProfileLayout />}>
      <Route path="identity" element={<IdentityPanel />} />
      <Route path="preferences" element={<PreferencesPanel />} />
      <Route path="notifications" element={<NotificationsPanel />} />
      <Route path="gaming/game-time" element={<ProfileGameTimePanel />} />
      <Route path="gaming/characters" element={<CharactersPanel />} />
      <Route path="gaming/watched-games" element={<WatchedGamesPanel />} />
      <Route path="identity/discord" element={<Navigate to="/profile/identity" replace />} />
      <Route path="identity/avatar" element={<Navigate to="/profile/identity" replace />} />
      <Route path="preferences/appearance" element={<Navigate to="/profile/preferences" replace />} />
      <Route path="preferences/timezone" element={<Navigate to="/profile/preferences" replace />} />
      <Route path="preferences/notifications" element={<Navigate to="/profile/notifications" replace />} />
      <Route path="gaming" element={<Navigate to="/profile/gaming/game-time" replace />} />
      <Route path="account" element={<Navigate to="/profile/identity" replace />} />
      <Route path="danger/delete-account" element={<Navigate to="/profile/identity" replace />} />
    </Route>
  );
}

function AdminSettingsRoutes() {
  return (
    <Route path="/admin/settings" element={<AdminSettingsLayout />}>
      <Route path="general" element={<GeneralPanel />} />
      <Route path="general/roles" element={<RolesPanel />} />
      <Route path="general/data" element={<DemoDataPanel />} />
      <Route path="general/cron-jobs" element={<CronJobsPanel />} />
      <Route path="general/backups" element={<BackupsPanel />} />
      <Route path="general/logs" element={<LogsPanel />} />
      <Route path="integrations/igdb" element={<IgdbPanel />} />
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
        <Route path="/characters/:id" element={<CharacterDetailPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/event-metrics" element={<MyEventsPage />} />
        <Route path="/events/new" element={<CreateEventPage />} />
        <Route path="/events/plan" element={<PlanEventPage />} />
        <Route path="/events/:id/metrics" element={<EventMetricsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/events/:id/edit" element={<EditEventPage />} />
        <Route path="/users/:userId" element={<UserProfilePage />} />
        {ProfileRoutes()}
        {AdminSettingsRoutes()}
      </Route>
    </Routes>
  );
}
