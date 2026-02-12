import { useState } from 'react';
import { toast } from '../../lib/toast';
import { useAdminSettings } from '../../hooks/use-admin-settings';

const EyeOffIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
);
const EyeIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
);

/**
 * Admin form for configuring GitHub Personal Access Token.
 * ROK-186: Feedback submissions create GitHub issues when configured.
 */
export function GitHubForm() {
    const { githubStatus, updateGitHub, testGitHub, clearGitHub } = useAdminSettings();

    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setTestResult(null);

        if (!token) {
            toast.error('Personal Access Token is required');
            return;
        }

        try {
            const result = await updateGitHub.mutateAsync({ token });
            if (result.success) {
                toast.success(result.message);
                setToken('');
            } else {
                toast.error(result.message);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save configuration';
            toast.error(message);
        }
    };

    const handleTest = async () => {
        setTestResult(null);
        try {
            const result = await testGitHub.mutateAsync();
            setTestResult(result);
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
        } catch {
            toast.error('Failed to test configuration');
        }
    };

    const handleClear = async () => {
        if (!confirm('Are you sure you want to clear the GitHub PAT? Feedback will only be saved locally.')) {
            return;
        }
        try {
            const result = await clearGitHub.mutateAsync();
            if (result.success) {
                toast.success(result.message);
                setTestResult(null);
            } else {
                toast.error(result.message);
            }
        } catch {
            toast.error('Failed to clear configuration');
        }
    };

    return (
        <>
            {/* Setup Instructions */}
            <div className="bg-gray-500/10 border border-gray-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-foreground">
                    <strong>Setup Instructions:</strong>
                </p>
                <ol className="text-sm text-secondary mt-2 space-y-1 list-decimal list-inside">
                    <li>Go to <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">GitHub Token Settings</a></li>
                    <li>Create a new fine-grained personal access token</li>
                    <li>Select the <strong>sjdodge123/Raid-Ledger</strong> repository</li>
                    <li>Grant <strong>Issues: Read and write</strong> permission</li>
                    <li>Paste the token below</li>
                </ol>
                <p className="text-xs text-dim mt-3">
                    When configured, user feedback submissions will automatically create GitHub issues on the Raid Ledger repository.
                    If the token is not configured or invalid, feedback is still saved locally in the database.
                </p>
            </div>

            {/* Configuration Form */}
            <form onSubmit={handleSave} className="space-y-4">
                <div>
                    <label htmlFor="githubPat" className="block text-sm font-medium text-secondary mb-1.5">
                        Personal Access Token
                    </label>
                    <div className="relative">
                        <input
                            id="githubPat"
                            type={showToken ? 'text' : 'password'}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder={githubStatus.data?.configured ? '••••••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
                            className="w-full px-4 py-3 pr-12 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-transparent transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowToken(!showToken)}
                            aria-label={showToken ? 'Hide token' : 'Show token'}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                        >
                            {showToken ? EyeOffIcon : EyeIcon}
                        </button>
                    </div>
                </div>

                {/* Test Result */}
                {testResult && (
                    <div className={`p-3 rounded-lg animate-[fadeIn_0.3s_ease-in] ${testResult.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : 'bg-red-500/10 border border-red-500/30 text-red-400'
                        }`}>
                        {testResult.message}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 pt-2">
                    <button
                        type="submit"
                        disabled={updateGitHub.isPending}
                        className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                    >
                        {updateGitHub.isPending ? 'Saving...' : 'Save Configuration'}
                    </button>

                    {githubStatus.data?.configured && (
                        <>
                            <button
                                type="button"
                                onClick={handleTest}
                                disabled={testGitHub.isPending}
                                className="py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors"
                            >
                                {testGitHub.isPending ? 'Testing...' : 'Test Connection'}
                            </button>

                            <button
                                type="button"
                                onClick={handleClear}
                                disabled={clearGitHub.isPending}
                                className="py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-semibold rounded-lg transition-colors border border-red-600/50"
                            >
                                Clear
                            </button>
                        </>
                    )}
                </div>
            </form>

            {/* Repo Info (when configured) */}
            {githubStatus.data?.configured && (
                <div className="mt-6 pt-6 border-t border-edge/50">
                    <div className="flex items-center gap-2 text-sm text-secondary">
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
                        </svg>
                        <span>
                            Target repository:{' '}
                            <a
                                href="https://github.com/sjdodge123/Raid-Ledger/issues"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline hover:text-gray-300"
                            >
                                sjdodge123/Raid-Ledger
                            </a>
                        </span>
                    </div>
                    <p className="text-xs text-dim mt-1.5">
                        Feedback categories map to GitHub labels: bug, enhancement, improvement, feedback.
                        All feedback issues are also tagged with <code className="text-xs bg-surface/50 px-1 rounded">user-feedback</code>.
                    </p>
                </div>
            )}
        </>
    );
}
