import { useState } from 'react';
import { useAuth } from '../../../hooks/use-auth';
import { useOnboarding } from '../../../hooks/use-onboarding';
import { API_BASE_URL } from '../../../lib/config';
import { toast } from '../../../lib/toast';

interface SecureAccountStepProps {
  onNext: () => void;
  onSkip: () => void;
}

/** Simple password strength checker */
function getPasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
  if (score <= 2) return { score, label: 'Fair', color: 'bg-orange-500' };
  if (score <= 3) return { score, label: 'Good', color: 'bg-yellow-500' };
  return { score, label: 'Strong', color: 'bg-emerald-500' };
}

/**
 * Step 1: Secure Account (ROK-204 AC-3)
 * - Change default admin password with strength indicator
 * - Link Discord account
 */
export function SecureAccountStep({ onNext, onSkip }: SecureAccountStepProps) {
  const { user } = useAuth();
  const { changePassword } = useOnboarding();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const hasDiscordLinked =
    user?.discordId != null && !user.discordId.startsWith('local:');

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmitPassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    passwordsMatch &&
    !changePassword.isPending;

  const handleChangePassword = () => {
    if (!canSubmitPassword) return;
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setPasswordChanged(true);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
        },
      },
    );
  };

  const handleLinkDiscord = () => {
    const token = localStorage.getItem('raid_ledger_token');
    if (!token) {
      toast.error('Please log in again to link Discord');
      return;
    }
    window.location.href = `${API_BASE_URL}/auth/discord/link?token=${encodeURIComponent(token)}`;
  };

  const handleSkip = () => {
    toast.warning(
      'Security reminder: Consider changing your default password soon.',
      { duration: 6000 },
    );
    onSkip();
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Secure Your Account
        </h2>
        <p className="text-sm text-muted mt-1">
          Protect your admin account by changing the default password and
          optionally linking your Discord.
        </p>
      </div>

      {/* Password Recovery Warning */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm text-amber-400 font-medium">Password Recovery</p>
            <p className="text-xs text-amber-400/70 mt-1">
              If you forget your password, the only way to recover access is by
              setting the{' '}
              <code className="px-1 py-0.5 bg-amber-500/10 rounded text-amber-300 font-mono text-[11px]">
                RESET_PASSWORD=true
              </code>{' '}
              environment variable and restarting the server. A new random password
              will be logged to stdout on startup.
            </p>
          </div>
        </div>
      </div>

      {/* Password Change Section */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Change Password
            </h3>
            <p className="text-xs text-muted mt-1">
              Replace the auto-generated admin password with something memorable.
            </p>
          </div>
          {passwordChanged && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <svg
                className="w-3.5 h-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Changed
            </span>
          )}
        </div>

        {!passwordChanged && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Current Password
              </label>
              <input
                type={showPasswords ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full sm:max-w-md px-4 py-2.5 min-h-[44px] bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                New Password
              </label>
              <input
                type={showPasswords ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full sm:max-w-md px-4 py-2.5 min-h-[44px] bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
              />
              {newPassword.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${strength.color}`}
                        style={{
                          width: `${(strength.score / 5) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted">{strength.label}</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Confirm New Password
              </label>
              <input
                type={showPasswords ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className={`w-full sm:max-w-md px-4 py-2.5 min-h-[44px] bg-surface/50 border rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm ${
                  confirmPassword.length > 0 && !passwordsMatch
                    ? 'border-red-500/50'
                    : 'border-edge'
                }`}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-xs text-red-400 mt-1">
                  Passwords do not match
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPasswords}
                  onChange={(e) => setShowPasswords(e.target.checked)}
                  className="rounded border-edge bg-surface/50"
                />
                Show passwords
              </label>
            </div>
            <button
              onClick={handleChangePassword}
              disabled={!canSubmitPassword}
              className="px-5 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
            >
              {changePassword.isPending
                ? 'Changing...'
                : 'Change Password'}
            </button>
          </div>
        )}
      </div>

      {/* Discord Link Section */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Link Discord
            </h3>
            <p className="text-xs text-muted mt-1">
              Connect your Discord account for avatar sync and future bot
              features.
            </p>
          </div>
          {hasDiscordLinked && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <svg
                className="w-3.5 h-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              Connected
            </span>
          )}
        </div>

        {!hasDiscordLinked && (
          <button
            onClick={handleLinkDiscord}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Link Discord Account
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-edge/30">
        <button
          onClick={handleSkip}
          className="text-sm text-muted hover:text-foreground transition-colors px-4 py-2.5 min-h-[44px] rounded-lg hover:bg-edge/20"
        >
          I'll do this later
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2.5 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}
