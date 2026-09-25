/**
 * Channel picker for the Start Lineup modal (ROK-1064).
 *
 * Renders a `Field` + `Select` (ROK-1650) of Discord text channels where the bot has post
 * permissions. The first option is always "Use community default channel"
 * (value `""`). Hidden when the bot is not connected or the query errors —
 * the feature simply becomes unavailable without blocking lineup creation.
 */
import type { JSX } from 'react';
import { usePostableDiscordChannels } from '../../hooks/use-postable-discord-channels';
import { Field } from '../ui/field';
import { Select } from '../ui/select';

interface Props {
  value: string;
  onChange: (channelId: string) => void;
}

const LABEL_ID = 'lineup-channel-override';

/** The community-default option, then one option per postable channel. */
function ChannelOptions({ loading, channels }: {
  loading: boolean;
  channels: ReadonlyArray<{ id: string; name: string }>;
}): JSX.Element {
  return (
    <>
      <option value="">
        {loading ? 'Loading channels…' : 'Use community default channel'}
      </option>
      {channels.map((ch) => (
        <option key={ch.id} value={ch.id}>
          #{ch.name}
        </option>
      ))}
    </>
  );
}

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
    <Field
      id={LABEL_ID}
      label="Post embeds to"
      hint="Optional. When set, every lineup embed posts to this channel instead of the community default."
    >
      <Select
        data-testid="lineup-channel-override-select"
        value={value}
        disabled={query.isLoading}
        onChange={(e) => onChange(e.target.value)}
      >
        <ChannelOptions loading={query.isLoading} channels={channels} />
      </Select>
    </Field>
  );
}
