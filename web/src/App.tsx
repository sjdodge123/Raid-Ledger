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
import { getCachedUser, fetchCurrentUser } from './hooks/use-auth';
import { getAuthMethod } from './lib/api/silent-reauth';
import { startBootSession, awaitBootSession } from './lib/api/boot-session';
import { installCrossTabAuth } from './lib/api/cross-tab-auth';
import { Layout } from './components/layout';
import { LoadingSpinner } from './components/ui/loading-spinner';
import { StartupGate } from './components/ui/StartupGate';
import { ConnectivityBanner } from './components/ui/ConnectivityBanner';
import { ThemeParticles } from './components/ui/ThemeParticles';
import { takeCapturedMagicLinkToken } from './lib/magic-link-capture';
import { startMagicLinkRedeem, isMagicLinkRedeemPending } from './lib/magic-link-redeem';
import { AppRoutes } from './app-routes';

// ROK-657/1366: the single-use magic-link token was already taken from the URL
// fragment and stripped by lib/magic-link-capture — main.tsx's first import,
// ahead of Sentry (the query string is never touched — `?token=` belongs to
// the join page). It is exchanged for a session by POST, never stored;
// fetchCurrentUser awaits the exchange. The redeem is skipped unless there is
// no stored session or /auth/me rejects it with 401/403 (OQ6).
const _magicLinkToken = takeCapturedMagicLinkToken();
if (_magicLinkToken) void startMagicLinkRedeem(_magicLinkToken);
// ROK-1754 §3.2/§3.3: re-mint the in-memory token from the refresh cookie
// (StartupGate waits for it), and follow logout/identity changes in other tabs.
void startBootSession();
installCrossTabAuth(queryClient);

// Seed auth cache from the cached user for instant return visits (a prior sign-in) — but not while
// a magic link may be swapping in a different user.
const _cachedUser = getCachedUser();
if (_cachedUser && getAuthMethod() && !_magicLinkToken) {
  queryClient.setQueryData(['auth', 'me'], _cachedUser);
}

import './plugins/wow/register';
import './plugins/discord/register';
import './plugins/ai/register';
import './App.css';

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
    const cleanup = startPolling();
    return cleanup;
  }, [startPolling]);

  useEffect(() => {
    if (getAuthMethod() || isMagicLinkRedeemPending()) {
      void awaitBootSession().then(() =>
        queryClient.prefetchQuery({ queryKey: ['auth', 'me'], queryFn: fetchCurrentUser, staleTime: 0 }),
      );
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
