/**
 * Channel picker for the Start Lineup modal (ROK-1064).
 *
 * Renders a `<select>` of Discord text channels where the bot has post
 * permissions. The first option is always "Use community default channel"
 * (value `""`). Hidden when the bot is not connected or the query errors —
 * the feature simply becomes unavailable without blocking lineup creation.
 */
import type { JSX } from 'react';
import { usePostableDiscordChannels } from '../../hooks/use-postable-discord-channels';

interface Props {
  value: string;
  onChange: (channelId: string) => void;
}

const LABEL_ID = 'lineup-channel-override';

/** Channel picker subcomponent. Returns null when feature is unavailable. */
export function LineupChannelOverrideSelect({
  value,
  onChange,
}: Props): JSX.Element | null {
  const query = usePostableDiscordChannels();

  if (query.isError) return null;
  // Hide if connected but no channels are available.
  const channels = query.data?.data ?? [];
  if (!query.isLoading && channels.length === 0) return null;

  return (
    <div>
      <label
        htmlFor={LABEL_ID}
        className="block text-sm font-medium text-secondary mb-1"
      >
        Post embeds to
      </label>
      <select
        id={LABEL_ID}
        data-testid="lineup-channel-override-select"
        value={value}
        disabled={query.isLoading}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-60"
      >
        <option value="">
          {query.isLoading
            ? 'Loading channels…'
            : 'Use community default channel'}
        </option>
        {channels.map((ch) => (
          <option key={ch.id} value={ch.id}>
            #{ch.name}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted mt-1">
        Optional. When set, every lineup embed posts to this channel instead
        of the community default.
      </p>
    </div>
  );
}
