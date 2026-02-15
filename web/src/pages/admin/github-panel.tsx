/**
 * Integrations > GitHub panel.
 * @deprecated ROK-306 — GitHub PAT integration replaced by Sentry error tracking.
 */
export function GitHubPanel() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">GitHub</h2>
                <p className="text-sm text-muted mt-1">Forward user feedback to GitHub Issues.</p>
            </div>
            <div
                className="rounded-xl p-6"
                style={{
                    backgroundColor: 'var(--color-panel)',
                    border: '1px solid var(--color-border)',
                }}
            >
                <div className="flex items-start gap-3">
                    <span className="text-2xl">🛡️</span>
                    <div>
                        <h3
                            className="font-semibold text-base"
                            style={{ color: 'var(--color-foreground)' }}
                        >
                            Replaced by Sentry
                        </h3>
                        <p
                            className="text-sm mt-1"
                            style={{ color: 'var(--color-muted)' }}
                        >
                            GitHub PAT integration has been replaced by Sentry error
                            tracking (ROK-306). User feedback is now automatically
                            forwarded to the maintainers via Sentry, and GitHub issues
                            are created via Sentry alert rules.
                        </p>
                        <p
                            className="text-sm mt-2"
                            style={{ color: 'var(--color-muted)' }}
                        >
                            No configuration is needed — this integration is managed
                            by the project maintainers.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
