// ROK-1366: capture + strip the magic-link fragment token BEFORE Sentry
// initialises, so it never reaches breadcrumbs, tracing or replay. This MUST
// stay the very first import (magic-link-capture.test.ts pins it).
import './lib/magic-link-capture';
// ROK-1839: the join flow's `?token=` lives in the query string, which DOES
// reach `window.location.href` — the source of a Session Replay's rrweb Meta
// href, the one href no scrub hook of ours can reach. Strip it here too.
import './lib/query-token-capture';
// ROK-306 / ROK-1779: Sentry next. Importing it installs the boot error
// buffer; nothing initialises until the telemetry decision below.
import { Sentry, initSentry } from './sentry';
import { bootstrap, fetchSystemStatus, renderBootFailure } from './bootstrap';

// ROK-1779 (Codex r6): App is NOT imported statically. bootstrap.ts decides
// telemetry first (GET /system/status, hard timeout, fail closed), runs
// initSentry, and only then imports the app — so Sentry's fetch/XHR wrappers
// are in place before native-fetch.ts captures them, and a throw while the
// app's modules evaluate is captured. bootstrap.test.ts pins this file's
// static imports.
void bootstrap({
  loadStatus: fetchSystemStatus,
  initSentry,
  loadApp: () => import('./app-entry'),
  reportFatal: (error, telemetryOn) => {
    console.error('[boot] the app failed to load', error);
    if (telemetryOn) Sentry.captureException(error, { tags: { 'boot.stage': 'app-import' } });
    renderBootFailure(document.getElementById('root'));
  },
});
