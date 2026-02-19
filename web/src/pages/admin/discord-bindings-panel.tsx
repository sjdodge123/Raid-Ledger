import { toast } from 'sonner';
import { useChannelBindings } from '../../hooks/use-channel-bindings';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { ChannelBindingList } from '../../components/admin/ChannelBindingList';
import type { UpdateChannelBindingDto } from '@raid-ledger/contract';

/**
 * Admin panel for managing Discord channel bindings.
 * Route: /admin/settings/integrations/channel-bindings
 * ROK-348: Channel Binding System.
 */
export function DiscordBindingsPanel() {
  const { bindings, updateBinding, deleteBinding } = useChannelBindings();
  const { discordBotStatus } = useAdminSettings();

  const isConnected = discordBotStatus.data?.connected ?? false;

  const handleUpdate = (id: string, dto: UpdateChannelBindingDto) => {
    updateBinding.mutate(
      { id, dto },
      {
        onSuccess: () => toast.success('Binding updated'),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteBinding.mutate(id, {
      onSuccess: () => toast.success('Binding removed'),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Channel Bindings
        </h2>
        <p className="text-sm text-muted mt-1">
          Map Discord channels to games for smart event routing. Use{' '}
          <code className="text-foreground bg-overlay px-1 py-0.5 rounded text-xs">
            /bind
          </code>{' '}
          in Discord for quick setup, or manage bindings here.
        </p>
      </div>

      {!isConnected && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <p className="text-sm text-amber-400">
            The Discord bot is not connected. Connect it in the{' '}
            <a
              href="/admin/settings/integrations/discord-bot"
              className="underline hover:text-amber-300"
            >
              Discord Bot settings
            </a>{' '}
            to manage channel bindings.
          </p>
        </div>
      )}

      {/* Routing priority info */}
      <div className="bg-overlay/30 rounded-lg p-4 border border-border">
        <h3 className="text-sm font-medium text-foreground mb-2">
          Event Routing Priority
        </h3>
        <ol className="list-decimal list-inside text-sm text-muted space-y-1">
          <li>
            <span className="text-foreground">Game-specific binding</span> — posts to the bound channel for that game
          </li>
          <li>
            <span className="text-foreground">Default text channel</span> — falls back to the channel set in bot settings
          </li>
          <li>
            <span className="text-foreground">No channel</span> — event page shows a warning
          </li>
        </ol>
      </div>

      {bindings.isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 bg-overlay rounded-lg"
            />
          ))}
        </div>
      ) : bindings.isError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-sm text-red-400">
            Failed to load bindings: {bindings.error.message}
          </p>
        </div>
      ) : (
        <ChannelBindingList
          bindings={bindings.data?.data ?? []}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          isUpdating={updateBinding.isPending}
          isDeleting={deleteBinding.isPending}
        />
      )}
    </div>
  );
}
