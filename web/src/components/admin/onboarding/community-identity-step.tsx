import { useState, useRef, useCallback } from 'react';
import { useOnboarding } from '../../../hooks/use-onboarding';
import { useBranding } from '../../../hooks/use-branding';
import { API_BASE_URL } from '../../../lib/config';
import {
  TIMEZONE_AUTO,
  TIMEZONE_OPTIONS,
  TIMEZONE_GROUPS,
  getBrowserTimezone,
} from '../../../constants/timezones';
import { getTimezoneAbbr } from '../../../lib/timezone-utils';

interface CommunityIdentityStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Step 2: Community Identity (ROK-204 AC-4)
 * - Community name
 * - Logo upload
 * - Default timezone
 * - Live preview of login page
 */
export function CommunityIdentityStep({
  onNext,
  onBack,
  onSkip,
}: CommunityIdentityStepProps) {
  const { updateCommunity } = useOnboarding();
  const { brandingQuery, uploadLogo } = useBranding();

  const branding = brandingQuery.data;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [communityName, setCommunityName] = useState(
    branding?.communityName || '',
  );
  const [timezone, setTimezone] = useState(TIMEZONE_AUTO);

  const browserTz = getBrowserTimezone();
  const browserAbbr = getTimezoneAbbr(browserTz);

  const logoUrl = branding?.communityLogoUrl
    ? `${API_BASE_URL}${branding.communityLogoUrl}`
    : null;

  const handleLogoUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      uploadLogo.mutate(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [uploadLogo],
  );

  const handleSaveAndNext = useCallback(() => {
    const updates: { communityName?: string; defaultTimezone?: string } = {};
    if (communityName.trim()) {
      updates.communityName = communityName.trim();
    }
    if (timezone !== TIMEZONE_AUTO) {
      updates.defaultTimezone = timezone;
    }

    if (Object.keys(updates).length > 0) {
      updateCommunity.mutate(updates, {
        onSuccess: () => onNext(),
      });
    } else {
      onNext();
    }
  }, [communityName, timezone, updateCommunity, onNext]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Community Identity
        </h2>
        <p className="text-sm text-muted mt-1">
          Set your community's name and branding. These appear on the login page
          and throughout the app.
        </p>
      </div>

      {/* Community Name */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Community Name
          </h3>
          <p className="text-xs text-muted mt-1">
            Displayed on the login page, page title, and header. Max 60
            characters.
          </p>
        </div>
        <input
          type="text"
          maxLength={60}
          value={communityName}
          onChange={(e) => setCommunityName(e.target.value)}
          placeholder="e.g., Midnight Raiders, The Vanguard"
          className="w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm"
        />
        <p className="text-xs text-dim">{communityName.length}/60</p>
      </div>

      {/* Logo Upload */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Community Logo
          </h3>
          <p className="text-xs text-muted mt-1">
            Optional. Square image, max 2 MB. PNG, JPEG, WebP, or SVG.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-lg border border-edge/50 bg-surface/30 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Community logo"
                className="w-full h-full object-contain"
              />
            ) : (
              <svg
                className="w-8 h-8 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            )}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadLogo.isPending}
            className="px-4 py-2 text-sm font-medium bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground transition-colors disabled:opacity-50"
          >
            {uploadLogo.isPending ? 'Uploading...' : 'Upload Logo'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handleLogoUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Default Timezone */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Default Timezone
          </h3>
          <p className="text-xs text-muted mt-1">
            Used as the default for community-wide displays (e.g., event
            schedules). Individual users see times in their own browser timezone
            by default and can override it in their profile.
          </p>
        </div>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full max-w-md px-4 py-3 bg-surface/50 border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors text-sm"
        >
          <option value={TIMEZONE_AUTO}>
            Auto -- detect from browser ({browserAbbr})
          </option>
          {TIMEZONE_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {TIMEZONE_OPTIONS.filter((o) => o.group === group).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} ({getTimezoneAbbr(o.id)})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Login Page Preview */}
      <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Login Page Preview
        </h3>
        <div className="bg-backdrop/80 rounded-lg border border-edge/30 p-8 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center bg-surface/30 border border-edge/50">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="w-full h-full object-contain"
              />
            ) : (
              <svg
                className="w-8 h-8 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                />
              </svg>
            )}
          </div>
          <span className="text-lg font-bold text-foreground">
            {communityName.trim() || 'Raid Ledger'}
          </span>
          <div className="w-56 space-y-2">
            <div className="h-9 bg-surface/30 rounded-lg border border-edge/30" />
            <div className="h-9 bg-surface/30 rounded-lg border border-edge/30" />
            <div className="h-9 bg-emerald-600/30 rounded-lg" />
          </div>
        </div>
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
          onClick={handleSaveAndNext}
          disabled={updateCommunity.isPending}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          {updateCommunity.isPending ? 'Saving...' : 'Next'}
        </button>
      </div>
    </div>
  );
}
