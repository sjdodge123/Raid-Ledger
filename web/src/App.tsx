import { Suspense, useEffect } from 'react';
import {
  BrowserRouter,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import { Toaster } from 'sonner';
import { useThemeStore } from './stores/theme-store';
import { useConnectivityStore } from './stores/connectivity-store';
import { queryClient } from './lib/query-client';
import { getAuthToken, setAuthToken, getCachedUser, fetchCurrentUser } from './hooks/use-auth';
import { Layout } from './components/layout';
import { LoadingSpinner } from './components/ui/loading-spinner';
import { StartupGate } from './components/ui/StartupGate';
import { ConnectivityBanner } from './components/ui/ConnectivityBanner';
import { ThemeParticles } from './components/ui/ThemeParticles';
import { CHUNK_RELOAD_KEY } from './lazy-routes';
import { readMagicLinkToken, hasMagicLinkToken, stripMagicLinkToken } from './lib/magic-link';
import { AppRoutes } from './app-routes';

// ROK-657: Consume magic link token from URL before React renders.
// ROK-1366: read the fragment first; `?token=` stays supported for links
// already sitting in Discord.
const _magicLinkToken = readMagicLinkToken(window.location);
if (_magicLinkToken && !getAuthToken()) {
  setAuthToken(_magicLinkToken);
}

// Seed auth cache from localStorage for instant return visits.
const _cachedUser = getCachedUser();
if (_cachedUser && getAuthToken()) {
  queryClient.setQueryData(['auth', 'me'], _cachedUser);
}

// Re-export for backward compat (used by tests)
export { CHUNK_RELOAD_KEY };

import './plugins/wow/register';
import './plugins/discord/register';
import './plugins/ai/register';
import './App.css';

/** Strip the magic-link token from the URL after consumption (ROK-657/1366) */
function MagicLinkCleanup() {
  const { search, pathname, hash } = useLocation();

  useEffect(() => {
    const location = { pathname, search, hash };
    if (hasMagicLinkToken(location)) {
      window.history.replaceState(null, '', stripMagicLinkToken(location));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Scroll to top on PUSH navigations */
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

function useAppBootstrap() {
  const startPolling = useConnectivityStore((s) => s.startPolling);

  useEffect(() => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  }, []);

  useEffect(() => {
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  useEffect(() => {
    if (getAuthToken()) {
      void queryClient.prefetchQuery({
        queryKey: ['auth', 'me'],
        queryFn: fetchCurrentUser,
        staleTime: 0,
      });
    }
  }, []);
}

function App() {
  const isDark = useThemeStore((s) => s.resolved.isDark);
  useAppBootstrap();

  return (
    <StartupGate>
      <ThemeParticles />
      <BrowserRouter>
        <MagicLinkCleanup />
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
            <AppRoutes />
          </Suspense>
        </Layout>
      </BrowserRouter>
    </StartupGate>
  );
}

export default App;
