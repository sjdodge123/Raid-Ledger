import { useState, useMemo, useCallback } from 'react';
import { useOnboarding } from '../../../hooks/use-onboarding';
import type { OnboardingGameDto } from '@raid-ledger/contract';

interface ChooseGamesStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Step 3: Choose Games (ROK-204 AC-5)
 * - Game list from game_registry with toggle switches
 * - Search filter
 * - Enable All / Disable All
 * - Count of enabled games
 */
export function ChooseGamesStep({
  onNext,
  onBack,
  onSkip,
}: ChooseGamesStepProps) {
  const { gamesQuery, toggleGame, bulkToggleGames } = useOnboarding();
  const [search, setSearch] = useState('');

  const enabledCount = gamesQuery.data?.meta.enabledCount ?? 0;
  const totalCount = gamesQuery.data?.meta.total ?? 0;

  const filteredGames = useMemo(() => {
    const games = gamesQuery.data?.data ?? [];
    if (!search.trim()) return games;
    const lower = search.toLowerCase();
    return games.filter((g) => g.name.toLowerCase().includes(lower));
  }, [gamesQuery.data?.data, search]);

  const handleToggle = useCallback(
    (game: OnboardingGameDto) => {
      toggleGame.mutate({ id: game.id, enabled: !game.enabled });
    },
    [toggleGame],
  );

  const handleEnableAll = useCallback(() => {
    const ids = filteredGames.filter((g) => !g.enabled).map((g) => g.id);
    if (ids.length > 0) {
      bulkToggleGames.mutate({ ids, enabled: true });
    }
  }, [filteredGames, bulkToggleGames]);

  const handleDisableAll = useCallback(() => {
    const ids = filteredGames.filter((g) => g.enabled).map((g) => g.id);
    if (ids.length > 0) {
      bulkToggleGames.mutate({ ids, enabled: false });
    }
  }, [filteredGames, bulkToggleGames]);

  if (gamesQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Choose Games
          </h2>
          <p className="text-sm text-muted mt-1">Loading game library...</p>
        </div>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-14 bg-panel/50 rounded-lg border border-edge/30"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Choose Games</h2>
        <p className="text-sm text-muted mt-1">
          Enable the games your community plays. Disabled games won't appear in
          event creation or character creation.
        </p>
      </div>

      {/* Counter + Search + Bulk Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <span className="text-sm text-muted">
          <span className="font-semibold text-emerald-400">{enabledCount}</span>{' '}
          of {totalCount} games enabled
        </span>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search games..."
            className="flex-1 sm:w-56 px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
          />
          <button
            onClick={handleEnableAll}
            disabled={bulkToggleGames.isPending}
            className="px-3 py-2 text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
          >
            Enable All
          </button>
          <button
            onClick={handleDisableAll}
            disabled={bulkToggleGames.isPending}
            className="px-3 py-2 text-xs font-medium bg-surface/50 hover:bg-surface border border-edge rounded-lg text-muted transition-colors whitespace-nowrap disabled:opacity-50"
          >
            Disable All
          </button>
        </div>
      </div>

      {/* Game List */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {filteredGames.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">
            {search ? 'No games match your search.' : 'No games found.'}
          </div>
        ) : (
          filteredGames.map((game) => (
            <div
              key={game.id}
              className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                game.enabled
                  ? 'bg-emerald-600/5 border-emerald-500/20'
                  : 'bg-panel/30 border-edge/30'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {game.iconUrl ? (
                  <img
                    src={game.iconUrl}
                    alt=""
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{
                      backgroundColor: game.colorHex || '#4B5563',
                    }}
                  >
                    {game.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span
                  className={`text-sm font-medium truncate ${
                    game.enabled ? 'text-foreground' : 'text-muted'
                  }`}
                >
                  {game.name}
                </span>
              </div>

              <button
                onClick={() => handleToggle(game)}
                disabled={toggleGame.isPending}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-backdrop flex-shrink-0 ${
                  game.enabled ? 'bg-emerald-600' : 'bg-surface/80'
                }`}
                role="switch"
                aria-checked={game.enabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    game.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          ))
        )}
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
