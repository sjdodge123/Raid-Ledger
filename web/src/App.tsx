import { lazy, Suspense, useEffect } from 'react';
import type { ComponentType } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import { Toaster } from 'sonner';
import { useThemeStore } from './stores/theme-store';
import { useConnectivityStore } from './stores/connectivity-store';
import { Layout } from './components/layout';
import { AuthGuard } from './components/auth';
import { RootRedirect } from './components/RootRedirect';
import { LoadingSpinner } from './components/ui/loading-spinner';
import { StartupGate } from './components/ui/StartupGate';
import { ConnectivityBanner } from './components/ui/ConnectivityBanner';

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
 * On first failure: sets a sessionStorage flag and reloads (fetches fresh HTML).
 * On second failure: throws so the ErrorBoundary can show a fallback.
 */
function lazyWithRetry<T extends ComponentType<Record<string, never>>>(
  importFn: () => Promise<{ default: T }>,
) {
  return lazy(() =>
    importFn().catch((error: unknown) => {
      if (isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        // Return a never-resolving promise — the page is reloading
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }),
  );
}

// -- Eagerly loaded pages (critical path) --
import { EventsPage } from './pages/events-page';
import { EventDetailPage } from './pages/event-detail-page';
import { AuthSuccessPage } from './pages/auth-success-page';

// -- Lazy loaded public pages --
const JoinPage = lazyWithRetry(() => import('./pages/join-page').then(m => ({ default: m.JoinPage })));
const InvitePage = lazyWithRetry(() => import('./pages/invite-page').then(m => ({ default: m.InvitePage })));

// -- Lazy loaded pages --
const CalendarPage = lazyWithRetry(() => import('./pages/calendar-page').then(m => ({ default: m.CalendarPage })));
const CreateEventPage = lazyWithRetry(() => import('./pages/create-event-page').then(m => ({ default: m.CreateEventPage })));
const PlanEventPage = lazyWithRetry(() => import('./pages/plan-event-page').then(m => ({ default: m.PlanEventPage })));
const EditEventPage = lazyWithRetry(() => import('./pages/edit-event-page').then(m => ({ default: m.EditEventPage })));
const GamesPage = lazyWithRetry(() => import('./pages/games-page').then(m => ({ default: m.GamesPage })));
const GameDetailPage = lazyWithRetry(() => import('./pages/game-detail-page').then(m => ({ default: m.GameDetailPage })));
const CharacterDetailPage = lazyWithRetry(() => import('./pages/character-detail-page').then(m => ({ default: m.CharacterDetailPage })));
const PlayersPage = lazyWithRetry(() => import('./pages/players-page').then(m => ({ default: m.PlayersPage })));
const MyEventsPage = lazyWithRetry(() => import('./pages/my-events-page').then(m => ({ default: m.MyEventsPage })));
const UserProfilePage = lazyWithRetry(() => import('./pages/user-profile-page').then(m => ({ default: m.UserProfilePage })));
const OnboardingWizardPage = lazyWithRetry(() => import('./pages/onboarding-wizard-page').then(m => ({ default: m.OnboardingWizardPage })));

// -- Lazy loaded profile panels (ROK-359 consolidated) --
const ProfileLayout = lazyWithRetry(() => import('./components/profile/profile-layout').then(m => ({ default: m.ProfileLayout })));
const IdentityPanel = lazyWithRetry(() => import('./pages/profile/identity-panel').then(m => ({ default: m.IdentityPanel })));
const PreferencesPanel = lazyWithRetry(() => import('./pages/profile/preferences-panel').then(m => ({ default: m.PreferencesPanel })));
const NotificationsPanel = lazyWithRetry(() => import('./pages/profile/notifications-panel').then(m => ({ default: m.NotificationsPanel })));
const ProfileGameTimePanel = lazyWithRetry(() => import('./pages/profile/game-time-panel').then(m => ({ default: m.ProfileGameTimePanel })));
const CharactersPanel = lazyWithRetry(() => import('./pages/profile/characters-panel').then(m => ({ default: m.CharactersPanel })));
const WatchedGamesPanel = lazyWithRetry(() => import('./pages/profile/watched-games-panel').then(m => ({ default: m.WatchedGamesPanel })));

// -- Lazy loaded admin panels --
const AdminSettingsLayout = lazyWithRetry(() => import('./components/admin/admin-settings-layout').then(m => ({ default: m.AdminSettingsLayout })));
const AdminSetupWizard = lazyWithRetry(() => import('./pages/admin/admin-setup-wizard').then(m => ({ default: m.AdminSetupWizard })));
const GeneralPanel = lazyWithRetry(() => import('./pages/admin/general-panel').then(m => ({ default: m.GeneralPanel })));
const RolesPanel = lazyWithRetry(() => import('./pages/admin/roles-panel').then(m => ({ default: m.RolesPanel })));
const DemoDataPanel = lazyWithRetry(() => import('./pages/admin/demo-data-panel').then(m => ({ default: m.DemoDataPanel })));

const IgdbPanel = lazyWithRetry(() => import('./pages/admin/igdb-panel').then(m => ({ default: m.IgdbPanel })));
const PluginsPanel = lazyWithRetry(() => import('./pages/admin/plugins-panel').then(m => ({ default: m.PluginsPanel })));
const PluginIntegrationPanel = lazyWithRetry(() => import('./pages/admin/plugin-integration-panel').then(m => ({ default: m.PluginIntegrationPanel })));
const CronJobsPanel = lazyWithRetry(() => import('./pages/admin/cron-jobs-panel').then(m => ({ default: m.CronJobsPanel })));
const BackupsPanel = lazyWithRetry(() => import('./pages/admin/backups-panel').then(m => ({ default: m.BackupsPanel })));


import './plugins/wow/register';
import './plugins/discord/register';
import './App.css';

/**
 * Scrolls to top on PUSH navigations (link clicks, programmatic navigate).
 * Skips POP navigations (back/forward) so the browser can restore scroll natively.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo(0, 0);
    }
  }, [pathname, navigationType]);

  return null;
}

function App() {
  const isDark = useThemeStore((s) => s.resolved.isDark);
  const startPolling = useConnectivityStore((s) => s.startPolling);

  useEffect(() => {
    // App mounted successfully — clear the chunk reload flag so future
    // navigations can retry a reload if a new deploy lands.
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  }, []);

  useEffect(() => {
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  return (
    <StartupGate>
      <BrowserRouter>
        <ScrollToTop />
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
                <Route path="/events/plan" element={<PlanEventPage />} />
                <Route path="/events/:id" element={<EventDetailPage />} />
                <Route path="/events/:id/edit" element={<EditEventPage />} />
                {/* ROK-181: Public user profiles */}
                <Route path="/users/:userId" element={<UserProfilePage />} />

                {/* ROK-359: Consolidated Profile pages */}
                <Route path="/profile" element={<ProfileLayout />}>
                  <Route path="identity" element={<IdentityPanel />} />
                  <Route path="preferences" element={<PreferencesPanel />} />
                  <Route path="notifications" element={<NotificationsPanel />} />
                  <Route path="gaming/game-time" element={<ProfileGameTimePanel />} />
                  <Route path="gaming/characters" element={<CharactersPanel />} />
                  <Route path="gaming/watched-games" element={<WatchedGamesPanel />} />

                  {/* ROK-359: Redirects for old bookmarked profile paths */}
                  <Route path="identity/discord" element={<Navigate to="/profile/identity" replace />} />
                  <Route path="identity/avatar" element={<Navigate to="/profile/identity" replace />} />
                  <Route path="preferences/appearance" element={<Navigate to="/profile/preferences" replace />} />
                  <Route path="preferences/timezone" element={<Navigate to="/profile/preferences" replace />} />
                  <Route path="preferences/notifications" element={<Navigate to="/profile/notifications" replace />} />
                  <Route path="gaming" element={<Navigate to="/profile/gaming/game-time" replace />} />
                  <Route path="account" element={<Navigate to="/profile/identity" replace />} />
                  <Route path="danger/delete-account" element={<Navigate to="/profile/identity" replace />} />
                </Route>

                {/* ROK-359: Consolidated Admin Settings */}
                <Route path="/admin/settings" element={<AdminSettingsLayout />}>
                  <Route path="general" element={<GeneralPanel />} />
                  <Route path="general/roles" element={<RolesPanel />} />
                  <Route path="general/data" element={<DemoDataPanel />} />
                  <Route path="general/cron-jobs" element={<CronJobsPanel />} />
                  <Route path="general/backups" element={<BackupsPanel />} />
                  <Route path="integrations/igdb" element={<IgdbPanel />} />

                  {/* Redirects for old Discord routes → plugin-managed panel */}
                  <Route path="integrations" element={<Navigate to="/admin/settings/integrations/plugin/discord/discord-oauth" replace />} />
                  <Route path="integrations/discord" element={<Navigate to="/admin/settings/integrations/plugin/discord/discord-oauth" replace />} />
                  <Route path="integrations/discord-bot" element={<Navigate to="/admin/settings/integrations/plugin/discord/discord-oauth" replace />} />
                  <Route path="integrations/channel-bindings" element={<Navigate to="/admin/settings/integrations/plugin/discord/discord-oauth" replace />} />
                  <Route path="integrations/plugin/:pluginSlug/:integrationKey" element={<PluginIntegrationPanel />} />
                  <Route path="plugins" element={<PluginsPanel />} />

                  {/* ROK-359: Redirects for old bookmarked admin paths */}
                  <Route path="appearance" element={<Navigate to="/admin/settings/general" replace />} />
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
