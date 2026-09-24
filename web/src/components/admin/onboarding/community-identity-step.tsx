import { useState, useCallback } from 'react';
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
import { LOGO_ACCEPT_MIME, LOGO_FORMAT_HINT } from '../../../constants/branding';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { Select } from '../../ui/select';
import { FilePicker } from '../../ui/file-picker';

interface CommunityIdentityStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const PlaceholderIcon = (
  <svg className="w-8 h-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const PreviewPlaceholderIcon = (
  <svg className="w-8 h-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
  </svg>
);

function LogoPreviewBox({ logoUrl }: { logoUrl: string | null }) {
    return (
        <div className="w-16 h-16 rounded-lg border border-edge/50 bg-surface/30 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl ? <img src={logoUrl} alt="Community logo" className="w-full h-full object-contain" /> : PlaceholderIcon}
        </div>
    );
}

function CommunityNameSection({ communityName, onChange }: { communityName: string; onChange: (v: string) => void }) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Community Name</h3>
                <p className="text-xs text-muted mt-1">Displayed on the login page, page title, and header. Max 60 characters.</p>
            </div>
            {/* The h3 above is the visible caption, so the Field label is sr-only (it still names the input). */}
            <Field label="Community name" hideLabel hint={`${communityName.length}/60`} className="sm:max-w-md">
                <Input type="text" maxLength={60} value={communityName} onChange={(e) => onChange(e.target.value)}
                    placeholder="e.g., Midnight Raiders, The Vanguard" />
            </Field>
        </div>
    );
}

function LogoUploadSection({ logoUrl, isPending, onFile }: {
    logoUrl: string | null; isPending: boolean; onFile: (file: File) => void;
}) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Community Logo</h3>
                <p className="text-xs text-muted mt-1">Optional. {LOGO_FORMAT_HINT}</p>
            </div>
            <div className="flex items-center gap-4">
                <LogoPreviewBox logoUrl={logoUrl} />
                <FilePicker variant="secondary" accept={LOGO_ACCEPT_MIME} loading={isPending} loadingLabel="Uploading…"
                    onFiles={(files) => onFile(files[0])}>
                    Upload Logo
                </FilePicker>
            </div>
        </div>
    );
}

function TimezoneSection({ timezone, onChange }: { timezone: string; onChange: (v: string) => void }) {
    const browserTz = getBrowserTimezone();
    const browserAbbr = getTimezoneAbbr(browserTz);

    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Default Timezone</h3>
                <p className="text-xs text-muted mt-1">Used as the default for community-wide displays (e.g., event schedules). Individual users see times in their own browser timezone by default and can override it in their profile.</p>
            </div>
            <Field label="Default timezone" hideLabel className="sm:max-w-md">
                <Select value={timezone} onChange={(e) => onChange(e.target.value)}>
                    <option value={TIMEZONE_AUTO}>Auto -- detect from browser ({browserAbbr})</option>
                    {TIMEZONE_GROUPS.map((group) => (
                        <optgroup key={group} label={group}>
                            {TIMEZONE_OPTIONS.filter((o) => o.group === group).map((o) => (
                                <option key={o.id} value={o.id}>{o.label} ({getTimezoneAbbr(o.id)})</option>
                            ))}
                        </optgroup>
                    ))}
                </Select>
            </Field>
        </div>
    );
}

function LoginPagePreview({ logoUrl, communityName }: { logoUrl: string | null; communityName: string }) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Login Page Preview</h3>
            <div className="bg-backdrop/80 rounded-lg border border-edge/30 p-8 flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center bg-surface/30 border border-edge/50">
                    {logoUrl ? <img src={logoUrl} alt="" className="w-full h-full object-contain" /> : PreviewPlaceholderIcon}
                </div>
                <span className="text-lg font-bold text-foreground">{communityName.trim() || 'Raid Ledger'}</span>
                <div className="w-56 space-y-2">
                    <div className="h-9 bg-surface/30 rounded-lg border border-edge/30" />
                    <div className="h-9 bg-surface/30 rounded-lg border border-edge/30" />
                    <div className="h-9 bg-success/30 rounded-lg" />
                </div>
            </div>
        </div>
    );
}

function StepNavigation({ onBack, onSkip, onNext, isPending }: {
    onBack: () => void; onSkip: () => void; onNext: () => void; isPending: boolean;
}) {
    return (
        <div className="flex items-center justify-between pt-4 border-t border-edge/30">
            <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={onBack}>Back</Button>
                <Button variant="ghost" onClick={onSkip}>Skip</Button>
            </div>
            <Button variant="primary" onClick={onNext} loading={isPending} loadingLabel="Saving…">Next</Button>
        </div>
    );
}

/**
 * Step 2: Community Identity (ROK-204 AC-4)
 */
function useCommunityIdentity(onNext: () => void) {
    const { updateCommunity } = useOnboarding();
    const { brandingQuery, uploadLogo } = useBranding();
    const branding = brandingQuery.data;
    const [communityName, setCommunityName] = useState(branding?.communityName || '');
    const [timezone, setTimezone] = useState(TIMEZONE_AUTO);
    const logoUrl = branding?.communityLogoUrl ? `${API_BASE_URL}${branding.communityLogoUrl}` : null;

    // FilePicker hands over a non-empty File[] and resets its input, so re-picking the same file uploads again.
    const handleLogoUpload = useCallback((file: File) => uploadLogo.mutate(file), [uploadLogo]);

    const handleSaveAndNext = useCallback(() => {
        const updates: { communityName?: string; defaultTimezone?: string } = {};
        if (communityName.trim()) updates.communityName = communityName.trim();
        if (timezone !== TIMEZONE_AUTO) updates.defaultTimezone = timezone;
        if (Object.keys(updates).length > 0) updateCommunity.mutate(updates, { onSuccess: () => onNext() });
        else onNext();
    }, [communityName, timezone, updateCommunity, onNext]);

    return { communityName, setCommunityName, timezone, setTimezone, logoUrl, uploadLogo, handleLogoUpload, handleSaveAndNext, updateCommunity };
}

/**
 * Step 2: Community Identity (ROK-204 AC-4)
 */
export function CommunityIdentityStep({ onNext, onBack, onSkip }: CommunityIdentityStepProps) {
    const h = useCommunityIdentity(onNext);

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Community Identity</h2>
                <p className="text-sm text-muted mt-1">Set your community's name and branding. These appear on the login page and throughout the app.</p>
            </div>
            <CommunityNameSection communityName={h.communityName} onChange={h.setCommunityName} />
            <LogoUploadSection logoUrl={h.logoUrl} isPending={h.uploadLogo.isPending} onFile={h.handleLogoUpload} />
            <TimezoneSection timezone={h.timezone} onChange={h.setTimezone} />
            <LoginPagePreview logoUrl={h.logoUrl} communityName={h.communityName} />
            <StepNavigation onBack={onBack} onSkip={onSkip} onNext={h.handleSaveAndNext} isPending={h.updateCommunity.isPending} />
        </div>
    );
}
