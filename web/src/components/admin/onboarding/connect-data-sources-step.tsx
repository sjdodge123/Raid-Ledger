import { useState } from 'react';
import { useOnboarding } from '../../../hooks/use-onboarding';

interface ConnectDataSourcesStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

type TestState = 'idle' | 'testing' | 'success' | 'error';

/**
 * Step 4: Connect Data Sources (ROK-204 AC-6)
 * - Blizzard API credentials
 * - IGDB/Twitch API credentials
 * - Test Connection button per integration
 * - All optional with clear skip messaging
 */
export function ConnectDataSourcesStep({
  onNext,
  onBack,
  onSkip,
}: ConnectDataSourcesStepProps) {
  const {
    dataSourcesQuery,
    saveBlizzardConfig,
    testBlizzardConfig,
    saveIgdbConfig,
    testIgdbConfig,
  } = useOnboarding();

  const dataSources = dataSourcesQuery.data;

  // Blizzard form state
  const [blizzClientId, setBlizzClientId] = useState('');
  const [blizzClientSecret, setBlizzClientSecret] = useState('');
  const [blizzTestState, setBlizzTestState] = useState<TestState>('idle');
  const [blizzTestMessage, setBlizzTestMessage] = useState('');

  // IGDB form state
  const [igdbClientId, setIgdbClientId] = useState('');
  const [igdbClientSecret, setIgdbClientSecret] = useState('');
  const [igdbTestState, setIgdbTestState] = useState<TestState>('idle');
  const [igdbTestMessage, setIgdbTestMessage] = useState('');

  const handleSaveBlizzard = () => {
    if (!blizzClientId.trim() || !blizzClientSecret.trim()) return;
    saveBlizzardConfig.mutate({
      clientId: blizzClientId.trim(),
      clientSecret: blizzClientSecret.trim(),
    });
  };

  const handleTestBlizzard = () => {
    setBlizzTestState('testing');
    testBlizzardConfig.mutate(undefined, {
      onSuccess: (data) => {
        setBlizzTestState(data.success ? 'success' : 'error');
        setBlizzTestMessage(data.message);
      },
      onError: (err) => {
        setBlizzTestState('error');
        setBlizzTestMessage(err.message);
      },
    });
  };

  const handleSaveIgdb = () => {
    if (!igdbClientId.trim() || !igdbClientSecret.trim()) return;
    saveIgdbConfig.mutate({
      clientId: igdbClientId.trim(),
      clientSecret: igdbClientSecret.trim(),
    });
  };

  const handleTestIgdb = () => {
    setIgdbTestState('testing');
    testIgdbConfig.mutate(undefined, {
      onSuccess: (data) => {
        setIgdbTestState(data.success ? 'success' : 'error');
        setIgdbTestMessage(data.message);
      },
      onError: (err) => {
        setIgdbTestState('error');
        setIgdbTestMessage(err.message);
      },
    });
  };

  const getStatusBadge = (configured: boolean) => {
    if (configured) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          Connected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface/50 text-muted border border-edge/50">
        Not Connected
      </span>
    );
  };

  const getTestBadge = (state: TestState, message: string) => {
    if (state === 'idle') return null;
    if (state === 'testing') {
      return (
        <span className="text-xs text-muted animate-pulse">Testing...</span>
      );
    }
    if (state === 'success') {
      return <span className="text-xs text-emerald-400">{message}</span>;
    }
    return <span className="text-xs text-red-400">{message}</span>;
  };

  if (dataSourcesQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Connect Data Sources
          </h2>
          <p className="text-sm text-muted mt-1">Loading integration status...</p>
        </div>
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-40 bg-panel/50 rounded-lg border border-edge/30"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Connect Data Sources
        </h2>
        <p className="text-sm text-muted mt-1">
          Optional API integrations for enhanced features. You can add or change
          these anytime in Admin Settings.
        </p>
      </div>

      {/* Blizzard API */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Blizzard API
            </h3>
            <p className="text-xs text-muted mt-1">
              Enables WoW character import via Armory lookup.
            </p>
          </div>
          {dataSources && getStatusBadge(dataSources.blizzard.configured)}
        </div>

        {!dataSources?.blizzard.configured && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Client ID
              </label>
              <input
                type="text"
                value={blizzClientId}
                onChange={(e) => setBlizzClientId(e.target.value)}
                placeholder="Blizzard API Client ID"
                className="w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Client Secret
              </label>
              <input
                type="password"
                value={blizzClientSecret}
                onChange={(e) => setBlizzClientSecret(e.target.value)}
                placeholder="Blizzard API Client Secret"
                className="w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveBlizzard}
                disabled={
                  !blizzClientId.trim() ||
                  !blizzClientSecret.trim() ||
                  saveBlizzardConfig.isPending
                }
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
              >
                {saveBlizzardConfig.isPending ? 'Saving...' : 'Save'}
              </button>
              {dataSources?.blizzard.configured && (
                <button
                  onClick={handleTestBlizzard}
                  disabled={blizzTestState === 'testing'}
                  className="px-4 py-2 bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm"
                >
                  Test Connection
                </button>
              )}
              {getTestBadge(blizzTestState, blizzTestMessage)}
            </div>
          </div>
        )}

        {dataSources?.blizzard.configured && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestBlizzard}
              disabled={blizzTestState === 'testing'}
              className="px-4 py-2 bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm"
            >
              Test Connection
            </button>
            {getTestBadge(blizzTestState, blizzTestMessage)}
          </div>
        )}

        {dataSources?.blizzard.configured && (
          <p className="text-xs text-emerald-400/70">
            WoW character import via Armory is available.
          </p>
        )}
      </div>

      {/* IGDB / Twitch API */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              IGDB / Twitch API
            </h3>
            <p className="text-xs text-muted mt-1">
              Enables game discovery, metadata enrichment, and Twitch stream
              integration.
            </p>
          </div>
          {dataSources && getStatusBadge(dataSources.igdb.configured)}
        </div>

        {!dataSources?.igdb.configured && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Client ID
              </label>
              <input
                type="text"
                value={igdbClientId}
                onChange={(e) => setIgdbClientId(e.target.value)}
                placeholder="Twitch / IGDB Client ID"
                className="w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Client Secret
              </label>
              <input
                type="password"
                value={igdbClientSecret}
                onChange={(e) => setIgdbClientSecret(e.target.value)}
                placeholder="Twitch / IGDB Client Secret"
                className="w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveIgdb}
                disabled={
                  !igdbClientId.trim() ||
                  !igdbClientSecret.trim() ||
                  saveIgdbConfig.isPending
                }
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm"
              >
                {saveIgdbConfig.isPending ? 'Saving...' : 'Save'}
              </button>
              {getTestBadge(igdbTestState, igdbTestMessage)}
            </div>
          </div>
        )}

        {dataSources?.igdb.configured && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestIgdb}
              disabled={igdbTestState === 'testing'}
              className="px-4 py-2 bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm"
            >
              Test Connection
            </button>
            {getTestBadge(igdbTestState, igdbTestMessage)}
          </div>
        )}

        {dataSources?.igdb.configured && (
          <p className="text-xs text-emerald-400/70">
            Game discovery, metadata, and Twitch streams are available.
          </p>
        )}
      </div>

      {/* Skip hint */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
        <p className="text-sm text-blue-400/80">
          These integrations are optional. You can add or change them anytime in{' '}
          <span className="font-medium">Admin Settings &gt; Integrations</span>.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-edge/30">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-5 py-2.5 bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground font-medium transition-colors text-sm"
          >
            Back
          </button>
          <button
            onClick={onSkip}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Skip
          </button>
        </div>
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}
