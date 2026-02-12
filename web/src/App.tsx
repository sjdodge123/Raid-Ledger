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
import { ProfilePage } from './pages/profile-page';
import { UserProfilePage } from './pages/user-profile-page';
import { AuthSuccessPage } from './pages/auth-success-page';
import { CalendarPage } from './pages/calendar-page';
import { AdminSettingsLayout } from './components/admin/admin-settings-layout';
import { GeneralPanel } from './pages/admin/general-panel';
import { RolesPanel } from './pages/admin/roles-panel';
import { DemoDataPanel } from './pages/admin/demo-data-panel';
import { DiscordPanel } from './pages/admin/discord-panel';
import { IgdbPanel } from './pages/admin/igdb-panel';
import { RelayPanel } from './pages/admin/relay-panel';
import { GitHubPanel } from './pages/admin/github-panel';
import { PluginsPanel } from './pages/admin/plugins-panel';
import { BrandingPanel } from './pages/admin/branding-panel';
import { PluginIntegrationPanel } from './pages/admin/plugin-integration-panel';
import { GamesPage } from './pages/games-page';
import { GameDetailPage } from './pages/game-detail-page';
import { CharacterDetailPage } from './pages/character-detail-page';
import { PlayersPage } from './pages/players-page';
import { MyEventsPage } from './pages/my-events-page';
import { FeedbackWidget } from './components/feedback/FeedbackWidget';
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
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/games/:id" element={<GameDetailPage />} />
            <Route path="/characters/:id" element={<CharacterDetailPage />} />
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/events" element={<EventsPage />} />
            {/* ROK-213: My Events dashboard */}
            <Route path="/my-events" element={<MyEventsPage />} />
            <Route path="/events/new" element={<CreateEventPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/events/:id/edit" element={<EditEventPage />} />
            {/* ROK-181: Public user profiles */}
            <Route path="/users/:userId" element={<UserProfilePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            {/* ROK-281: Admin Settings with always-expanded sidebar navigation */}
            <Route path="/admin/settings" element={<AdminSettingsLayout />}>
              <Route path="general" element={<GeneralPanel />} />
              <Route path="general/roles" element={<RolesPanel />} />
              <Route path="general/data" element={<DemoDataPanel />} />
              <Route path="integrations" element={<DiscordPanel />} />
              <Route path="integrations/igdb" element={<IgdbPanel />} />
              <Route path="integrations/relay" element={<RelayPanel />} />
              <Route path="integrations/github" element={<GitHubPanel />} />
              <Route path="integrations/plugin/:pluginSlug/:integrationKey" element={<PluginIntegrationPanel />} />
              <Route path="plugins" element={<PluginsPanel />} />
              <Route path="appearance" element={<BrandingPanel />} />
            </Route>
          </Route>
        </Routes>
      </Layout>
      <FeedbackWidget />
    </BrowserRouter>
  );
}

export default App;
