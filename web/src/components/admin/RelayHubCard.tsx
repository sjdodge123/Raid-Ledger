import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useRelaySettings } from '../../hooks/use-relay-settings';

const DEFAULT_RELAY_URL = 'https://hub.raid-ledger.com';

// Relay hub icon
const RelayIcon = (
    <div className="w-10 h-10 rounded-lg bg-sky-600 flex items-center justify-center">
        <svg className="w-6 h-6 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"
            />
        </svg>
    </div>
);

// Loading spinner SVG
const Spinner = (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

/**
 * Relay Hub management card (ROK-273).
 * Allows admins to connect/disconnect from the Raid Ledger relay hub.
 */
export function RelayHubCard() {
    const { relayStatus, updateRelay, connectRelay, disconnectRelay } = useRelaySettings();
    const [relayUrl, setRelayUrl] = useState('');
    const [urlEdited, setUrlEdited] = useState(false);

    const status = relayStatus.data;
    const isOperating =
        connectRelay.isPending || disconnectRelay.isPending || updateRelay.isPending;

    // Current effective URL
    const currentUrl = urlEdited ? relayUrl : (status?.relayUrl || DEFAULT_RELAY_URL);

    const handleConnect = async () => {
        try {
            // Save URL first if edited
            if (urlEdited && relayUrl !== status?.relayUrl) {
                await updateRelay.mutateAsync({ relayUrl, enabled: true });
            }

            const result = await connectRelay.mutateAsync();
            if (result.connected) {
                toast.success('Connected to Raid Ledger Hub');
                setUrlEdited(false);
            } else {
                toast.error(result.error || 'Failed to connect to relay hub');
            }
        } catch {
            toast.error('Failed to connect to relay hub');
        }
    };

    const handleDisconnect = async () => {
        try {
            await disconnectRelay.mutateAsync();
            toast.success('Disconnected from Raid Ledger Hub');
            setUrlEdited(false);
        } catch {
            toast.error('Failed to disconnect from relay hub');
        }
    };

    // Connection status indicator
    const connectionStatusBadge = (() => {
        if (relayStatus.isLoading) {
            return (
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-overlay text-muted">
                    Loading...
                </span>
            );
        }

        if (status?.connected) {
            return (
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-500/20 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.4)]">
                    Connected
                </span>
            );
        }

        if (status?.enabled && status?.error) {
            return (
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-500/20 text-red-400">
                    Error
                </span>
            );
        }

        return (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-overlay text-muted">
                Not Connected
            </span>
        );
    })();

    return (
        <div className="bg-panel/50 backdrop-blur-sm rounded-xl border border-edge/50 overflow-hidden">
            {/* Header */}
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {RelayIcon}
                    <div className="text-left">
                        <h2 className="text-lg font-semibold text-foreground">Relay Hub</h2>
                        <p className="text-sm text-muted">
                            Connect to the Raid Ledger Hub for deployment metrics
                        </p>
                    </div>
                </div>
                {connectionStatusBadge}
            </div>

            {/* Content */}
            <div className="p-6 pt-2 border-t border-edge/50 space-y-4">
                <p className="text-sm text-secondary">
                    Opt in to anonymous usage reporting. No personal data or player information
                    is ever shared — only aggregate counts (players, events, active games) and
                    uptime. You can disconnect at any time.
                </p>

                {/* Relay URL */}
                <div>
                    <label
                        htmlFor="relay-url"
                        className="block text-sm font-medium text-foreground mb-1.5"
                    >
                        Relay URL
                    </label>
                    <input
                        id="relay-url"
                        type="url"
                        value={currentUrl}
                        onChange={(e) => {
                            setRelayUrl(e.target.value);
                            setUrlEdited(true);
                        }}
                        disabled={status?.connected || isOperating}
                        placeholder={DEFAULT_RELAY_URL}
                        className="w-full px-3 py-2 bg-surface/50 border border-edge/50 rounded-lg text-foreground placeholder-muted text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <p className="text-xs text-dim mt-1">
                        Default: {DEFAULT_RELAY_URL}. Change only for self-hosted relay hubs.
                    </p>
                </div>

                {/* Instance ID (shown when connected) */}
                {status?.instanceId && status.connected && (
                    <div className="bg-surface/30 rounded-lg p-3">
                        <div className="text-xs text-muted mb-0.5">Instance ID</div>
                        <div className="text-sm text-secondary font-mono break-all">
                            {status.instanceId}
                        </div>
                    </div>
                )}

                {/* Error message */}
                {status?.error && !status.connected && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-sm text-red-400">{status.error}</p>
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                    {status?.connected ? (
                        <button
                            onClick={handleDisconnect}
                            disabled={isOperating}
                            className="flex-1 py-2.5 px-4 bg-red-600/20 hover:bg-red-600/30 disabled:bg-red-800/20 disabled:cursor-not-allowed text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50 flex items-center justify-center gap-2"
                        >
                            {disconnectRelay.isPending && Spinner}
                            {disconnectRelay.isPending ? 'Disconnecting...' : 'Disconnect'}
                        </button>
                    ) : (
                        <button
                            onClick={handleConnect}
                            disabled={isOperating}
                            className="flex-1 py-2.5 px-4 bg-sky-600 hover:bg-sky-500 disabled:bg-sky-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            {connectRelay.isPending && Spinner}
                            {connectRelay.isPending ? 'Connecting...' : 'Connect to Raid Ledger Hub'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
