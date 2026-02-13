import { Link } from 'react-router-dom';
import { useOnboarding } from '../../../hooks/use-onboarding';

interface DoneStepProps {
  onComplete: () => void;
}

/**
 * Step 4: Done (ROK-204)
 * Summary of what was configured vs. skipped.
 */
export function DoneStep({ onComplete }: DoneStepProps) {
  const { statusQuery, dataSourcesQuery } = useOnboarding();

  const steps = statusQuery.data?.steps;
  const dataSources = dataSourcesQuery.data;

  const items = [
    {
      label: 'Password Changed',
      done: steps?.secureAccount ?? false,
      skipMessage: 'Default password still in use',
    },
    {
      label: 'Community Identity',
      done: steps?.communityIdentity ?? false,
      skipMessage: 'Using default settings',
    },
    {
      label: 'Plugins',
      done: steps?.connectPlugins ?? false,
      skipMessage: 'No plugins configured',
    },
    {
      label: 'Blizzard API',
      done: dataSources?.blizzard.configured ?? false,
      skipMessage: 'Not connected',
    },
    {
      label: 'IGDB / Twitch API',
      done: dataSources?.igdb.configured ?? false,
      skipMessage: 'Not connected',
    },
    {
      label: 'Discord OAuth',
      done: dataSources?.discord.configured ?? false,
      skipMessage: 'Not configured',
    },
  ];

  const skippedItems = items.filter((i) => !i.done && i.skipMessage);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-600/20 border-2 border-emerald-500/50 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-emerald-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-foreground">
          You're All Set!
        </h2>
        <p className="text-sm text-muted mt-2 max-w-md mx-auto">
          Your community is ready to go. Here's a summary of your setup.
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Configuration Summary
        </h3>
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between py-2 border-b border-edge/20 last:border-0"
            >
              <span className="text-sm text-foreground">{item.label}</span>
              <div className="flex items-center gap-2">
                {item.done ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400">
                    <svg
                      className="w-3 h-3"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Done
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400">
                    Skipped
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Skipped items notice */}
      {skippedItems.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
          <p className="text-sm text-amber-400/80">
            You can complete the skipped items anytime in{' '}
            <Link
              to="/admin/settings/general"
              className="font-medium underline underline-offset-2"
            >
              Admin Settings
            </Link>
            .
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
        <button
          onClick={onComplete}
          className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors text-sm"
        >
          Go to Dashboard
        </button>
        <Link
          to="/admin/settings/general"
          className="text-sm text-muted hover:text-foreground transition-colors underline underline-offset-2"
        >
          Review Settings
        </Link>
      </div>
    </div>
  );
}
