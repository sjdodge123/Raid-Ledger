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
import { AppRoutes } from './app-routes';

// ROK-657: Consume magic link token from URL before React renders.
const _magicLinkParams = new URLSearchParams(window.location.search);
const _magicLinkToken = _magicLinkParams.get('token');
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
import './App.css';

/** Strip ?token= from URL after magic link consumption (ROK-657) */
function MagicLinkCleanup() {
  const { search, pathname, hash } = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.has('token')) {
      params.delete('token');
      const cleaned = params.toString();
      const newUrl = pathname + (cleaned ? `?${cleaned}` : '') + hash;
      window.history.replaceState(null, '', newUrl);
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
