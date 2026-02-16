import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useThemeStore } from './stores/theme-store';
import { Layout } from './components/layout';
import { AuthGuard } from './components/auth';
import { RootRedirect } from './components/RootRedirect';
import { EventsPage } from './pages/events-page';
import { EventDetailPage } from './pages/event-detail-page';
import { CreateEventPage } from './pages/create-event-page';
import { EditEventPage } from './pages/edit-event-page';
import { ProfileLayout } from './components/profile/profile-layout';
import { IdentityPanel } from './pages/profile/identity-panel';
import { ProfileDiscordPanel } from './pages/profile/discord-panel';
import { AvatarPanel } from './pages/profile/avatar-panel';
import { AppearancePanel } from './pages/profile/appearance-panel';
import { TimezonePanel } from './pages/profile/timezone-panel';
import { NotificationsPanel } from './pages/profile/notifications-panel';
import { ProfileGameTimePanel } from './pages/profile/game-time-panel';
import { CharactersPanel } from './pages/profile/characters-panel';
import { UserProfilePage } from './pages/user-profile-page';
import { AuthSuccessPage } from './pages/auth-success-page';
import { CalendarPage } from './pages/calendar-page';
import { AdminSettingsLayout } from './components/admin/admin-settings-layout';
import { GeneralPanel } from './pages/admin/general-panel';
import { RolesPanel } from './pages/admin/roles-panel';
import { DemoDataPanel } from './pages/admin/demo-data-panel';
import { DiscordPanel } from './pages/admin/discord-panel';
import { IgdbPanel } from './pages/admin/igdb-panel';

import { DiscordBotPanel } from './pages/admin/discord-bot-panel';
import { PluginsPanel } from './pages/admin/plugins-panel';
import { BrandingPanel } from './pages/admin/branding-panel';
import { PluginIntegrationPanel } from './pages/admin/plugin-integration-panel';
import { CronJobsPanel } from './pages/admin/cron-jobs-panel';
import { GamesPage } from './pages/games-page';
import { GameDetailPage } from './pages/game-detail-page';
import { CharacterDetailPage } from './pages/character-detail-page';
import { PlayersPage } from './pages/players-page';
import { MyEventsPage } from './pages/my-events-page';
import { AdminSetupWizard } from './pages/admin/admin-setup-wizard';
import { OnboardingWizardPage } from './pages/onboarding-wizard-page';

import './plugins/wow/register';
import './App.css';

function App() {
  const isDark = useThemeStore((s) => s.resolved.isDark);

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        theme={isDark ? 'dark' : 'light'}
        richColors
        closeButton
        offset="72px"
        duration={5000}
      />
      <Layout>
        <Routes>
          {/* -- Public routes (no auth required) -- */}
          {/* ROK-175: Root shows login or redirects to events based on auth */}
          <Route path="/" element={<RootRedirect />} />
          {/* Legacy /login redirects to root (AC-2) */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          {/* OAuth callback -- must stay public for Discord redirect flow */}
          <Route path="/auth/success" element={<AuthSuccessPage />} />

          {/* -- Protected routes (ROK-283: global auth guard) -- */}
          <Route element={<AuthGuard />}>
            {/* ROK-219: First-time user experience wizard */}
            <Route path="/onboarding" element={<OnboardingWizardPage />} />
            {/* ROK-204: Admin onboarding wizard */}
            <Route path="/admin/setup" element={<AdminSetupWizard />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/games/:id" element={<GameDetailPage />} />
            <Route path="/characters/:id" element={<CharacterDetailPage />} />
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/events" element={<EventsPage />} />
            {/* ROK-213: My Events dashboard */}
            <Route path="/event-metrics" element={<MyEventsPage />} />
            <Route path="/events/new" element={<CreateEventPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/events/:id/edit" element={<EditEventPage />} />
            {/* ROK-181: Public user profiles */}
            <Route path="/users/:userId" element={<UserProfilePage />} />
            {/* ROK-290: Profile page with sidebar navigation */}
            <Route path="/profile" element={<ProfileLayout />}>
              <Route path="identity" element={<IdentityPanel />} />
              <Route path="identity/discord" element={<ProfileDiscordPanel />} />
              <Route path="identity/avatar" element={<AvatarPanel />} />
              <Route path="preferences/appearance" element={<AppearancePanel />} />
              <Route path="preferences/timezone" element={<TimezonePanel />} />
              <Route path="preferences/notifications" element={<NotificationsPanel />} />
              <Route path="gaming/game-time" element={<ProfileGameTimePanel />} />
              <Route path="gaming/characters" element={<CharactersPanel />} />
            </Route>
            {/* ROK-281: Admin Settings with always-expanded sidebar navigation */}
            <Route path="/admin/settings" element={<AdminSettingsLayout />}>
              <Route path="general" element={<GeneralPanel />} />
              <Route path="general/roles" element={<RolesPanel />} />
              <Route path="general/data" element={<DemoDataPanel />} />
              <Route path="general/cron-jobs" element={<CronJobsPanel />} />
              <Route path="integrations" element={<DiscordPanel />} />
              <Route path="integrations/igdb" element={<IgdbPanel />} />

              <Route path="integrations/discord-bot" element={<DiscordBotPanel />} />
              <Route path="integrations/plugin/:pluginSlug/:integrationKey" element={<PluginIntegrationPanel />} />
              <Route path="plugins" element={<PluginsPanel />} />
              <Route path="appearance" element={<BrandingPanel />} />
            </Route>
          </Route>
        </Routes>
      </Layout>

    </BrowserRouter>
  );
}

export default App;
