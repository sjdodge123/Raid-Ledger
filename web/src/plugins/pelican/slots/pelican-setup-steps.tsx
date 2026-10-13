/** How to make a least-privilege Pelican client key (ROK-121 ruling Q5). */
export function PelicanSetupSteps() {
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 mb-6">
            <p className="text-sm text-foreground"><strong>Setup Instructions:</strong></p>
            <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                <li>In Pelican, create a dedicated user for Raid Ledger</li>
                <li>Add that user as a <strong>subuser</strong> to only the servers you want shown, with read-only permissions</li>
                <li>Signed in as that user, open Account → API Keys and create a <strong>client</strong> key (<code>pacc_</code>)</li>
                <li>Set the key&apos;s Allowed IPs to this Raid Ledger host</li>
                <li>Paste the panel URL and the key below, save, then Test Connection</li>
            </ol>
        </div>
    );
}
