/**
 * How to make a least-privilege Pelican client key (ROK-121 ruling Q5).
 * ROK-1800: spells out the subuser permissions, including the console
 * stream Quick Play detection reads (Pelican grants websocket access to
 * every subuser; there is no checkbox for it).
 */
export function PelicanSetupSteps() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>In Pelican, create a dedicated user for Raid Ledger</li>
                <li>
                    On each server you want shown, open Users → Invite and add that user as a <strong>subuser</strong>:
                    <ul className="mt-1 ml-5 space-y-0.5 list-disc">
                        <li><strong>Schedule:</strong> Read only</li>
                        <li><strong>Control:</strong> nothing (no Console, Start, Stop or Restart)</li>
                        <li><strong>Everything else:</strong> unchecked; don&apos;t use Assign all</li>
                        <li>
                            Console access for Quick Play detection needs no checkbox: Pelican lets every
                            subuser read a server&apos;s console stream, and Raid Ledger never sends commands
                        </li>
                    </ul>
                </li>
                <li>Signed in as that user, open Account → API Keys and create a <strong>client</strong> key (<code>pacc_</code>)</li>
                <li>Set the key&apos;s Allowed IPs to this Raid Ledger host</li>
                <li>Paste the panel URL and the key below, save, then Test Connection</li>
            </ol>
        </div>
    );
}
