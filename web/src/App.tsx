import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useThemeStore } from './stores/theme-store';
import { useConnectivityStore } from './stores/connectivity-store';
import { Layout } from './components/layout';
import { AuthGuard } from './components/auth';
import { RootRedirect } from './components/RootRedirect';
import { LoadingSpinner } from './components/ui/loading-spinner';
import { StartupGate } from './components/ui/StartupGate';
import { ConnectivityBanner } from './components/ui/ConnectivityBanner';

// -- Eagerly loaded pages (critical path) --
import { EventsPage } from './pages/events-page';
import { EventDetailPage } from './pages/event-detail-page';
import { AuthSuccessPage } from './pages/auth-success-page';

// -- Lazy loaded public pages --
const JoinPage = lazy(() => import('./pages/join-page').then(m => ({ default: m.JoinPage })));
const InvitePage = lazy(() => import('./pages/invite-page').then(m => ({ default: m.InvitePage })));

// -- Lazy loaded pages --
const CalendarPage = lazy(() => import('./pages/calendar-page').then(m => ({ default: m.CalendarPage })));
const CreateEventPage = lazy(() => import('./pages/create-event-page').then(m => ({ default: m.CreateEventPage })));
const EditEventPage = lazy(() => import('./pages/edit-event-page').then(m => ({ default: m.EditEventPage })));
const GamesPage = lazy(() => import('./pages/games-page').then(m => ({ default: m.GamesPage })));
const GameDetailPage = lazy(() => import('./pages/game-detail-page').then(m => ({ default: m.GameDetailPage })));
const CharacterDetailPage = lazy(() => import('./pages/character-detail-page').then(m => ({ default: m.CharacterDetailPage })));
const PlayersPage = lazy(() => import('./pages/players-page').then(m => ({ default: m.PlayersPage })));
const MyEventsPage = lazy(() => import('./pages/my-events-page').then(m => ({ default: m.MyEventsPage })));
const UserProfilePage = lazy(() => import('./pages/user-profile-page').then(m => ({ default: m.UserProfilePage })));
const OnboardingWizardPage = lazy(() => import('./pages/onboarding-wizard-page').then(m => ({ default: m.OnboardingWizardPage })));

// -- Lazy loaded profile panels --
const ProfileLayout = lazy(() => import('./components/profile/profile-layout').then(m => ({ default: m.ProfileLayout })));
const IdentityPanel = lazy(() => import('./pages/profile/identity-panel').then(m => ({ default: m.IdentityPanel })));
const ProfileDiscordPanel = lazy(() => import('./pages/profile/discord-panel').then(m => ({ default: m.ProfileDiscordPanel })));
const AvatarPanel = lazy(() => import('./pages/profile/avatar-panel').then(m => ({ default: m.AvatarPanel })));
const AppearancePanel = lazy(() => import('./pages/profile/appearance-panel').then(m => ({ default: m.AppearancePanel })));
const TimezonePanel = lazy(() => import('./pages/profile/timezone-panel').then(m => ({ default: m.TimezonePanel })));
const NotificationsPanel = lazy(() => import('./pages/profile/notifications-panel').then(m => ({ default: m.NotificationsPanel })));
const ProfileGameTimePanel = lazy(() => import('./pages/profile/game-time-panel').then(m => ({ default: m.ProfileGameTimePanel })));
const CharactersPanel = lazy(() => import('./pages/profile/characters-panel').then(m => ({ default: m.CharactersPanel })));
const DeleteAccountPanel = lazy(() => import('./pages/profile/delete-account-panel').then(m => ({ default: m.DeleteAccountPanel })));

// -- Lazy loaded admin panels --
const AdminSettingsLayout = lazy(() => import('./components/admin/admin-settings-layout').then(m => ({ default: m.AdminSettingsLayout })));
const AdminSetupWizard = lazy(() => import('./pages/admin/admin-setup-wizard').then(m => ({ default: m.AdminSetupWizard })));
const GeneralPanel = lazy(() => import('./pages/admin/general-panel').then(m => ({ default: m.GeneralPanel })));
const RolesPanel = lazy(() => import('./pages/admin/roles-panel').then(m => ({ default: m.RolesPanel })));
const DemoDataPanel = lazy(() => import('./pages/admin/demo-data-panel').then(m => ({ default: m.DemoDataPanel })));
const DiscordPanel = lazy(() => import('./pages/admin/discord-panel').then(m => ({ default: m.DiscordPanel })));
const IgdbPanel = lazy(() => import('./pages/admin/igdb-panel').then(m => ({ default: m.IgdbPanel })));
const DiscordBotPanel = lazy(() => import('./pages/admin/discord-bot-panel').then(m => ({ default: m.DiscordBotPanel })));
const PluginsPanel = lazy(() => import('./pages/admin/plugins-panel').then(m => ({ default: m.PluginsPanel })));
const BrandingPanel = lazy(() => import('./pages/admin/branding-panel').then(m => ({ default: m.BrandingPanel })));
const PluginIntegrationPanel = lazy(() => import('./pages/admin/plugin-integration-panel').then(m => ({ default: m.PluginIntegrationPanel })));
const CronJobsPanel = lazy(() => import('./pages/admin/cron-jobs-panel').then(m => ({ default: m.CronJobsPanel })));
const BackupsPanel = lazy(() => import('./pages/admin/backups-panel').then(m => ({ default: m.BackupsPanel })));
const DiscordBindingsPanel = lazy(() => import('./pages/admin/discord-bindings-panel').then(m => ({ default: m.DiscordBindingsPanel })));

import './plugins/wow/register';
import './App.css';

function App() {
  const isDark = useThemeStore((s) => s.resolved.isDark);
  const startPolling = useConnectivityStore((s) => s.startPolling);

  useEffect(() => {
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  return (
    <StartupGate>
      <BrowserRouter>
        <Toaster
          position="top-right"
          theme={isDark ? 'dark' : 'light'}
          richColors
          closeButton
          offset="72px"
          duration={5000}
        />
        <ConnectivityBanner />
        <Layout>
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              {/* -- Public routes (no auth required) -- */}
              {/* ROK-175: Root shows login or redirects to events based on auth */}
              <Route path="/" element={<RootRedirect />} />
              {/* Legacy /login redirects to root (AC-2) */}
              <Route path="/login" element={<Navigate to="/" replace />} />
              {/* OAuth callback -- must stay public for Discord redirect flow */}
              <Route path="/auth/success" element={<AuthSuccessPage />} />
              {/* ROK-137: Deferred signup landing page (public — handles intent tokens) */}
              <Route path="/join" element={<JoinPage />} />
              <Route path="/i/:code" element={<InvitePage />} />

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
                  <Route path="danger/delete-account" element={<DeleteAccountPanel />} />
                </Route>
                {/* ROK-281: Admin Settings with always-expanded sidebar navigation */}
                <Route path="/admin/settings" element={<AdminSettingsLayout />}>
                  <Route path="general" element={<GeneralPanel />} />
                  <Route path="general/roles" element={<RolesPanel />} />
                  <Route path="general/data" element={<DemoDataPanel />} />
                  <Route path="general/cron-jobs" element={<CronJobsPanel />} />
                  <Route path="general/backups" element={<BackupsPanel />} />
                  <Route path="integrations" element={<DiscordPanel />} />
                  <Route path="integrations/igdb" element={<IgdbPanel />} />
                  <Route path="integrations/discord-bot" element={<DiscordBotPanel />} />
                  <Route path="integrations/channel-bindings" element={<DiscordBindingsPanel />} />
                  <Route path="integrations/plugin/:pluginSlug/:integrationKey" element={<PluginIntegrationPanel />} />
                  <Route path="plugins" element={<PluginsPanel />} />
                  <Route path="appearance" element={<BrandingPanel />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
    </StartupGate>
  );
}

export default App;
