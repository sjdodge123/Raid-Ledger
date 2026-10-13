import { useState, useCallback } from 'react';
import { useBranding, type BrandingUpdate } from '../../hooks/use-branding';
import { API_BASE_URL } from '../../lib/config';
import { LOGO_ACCEPT_MIME, LOGO_FORMAT_HINT } from '../../constants/branding';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { FilePicker } from '../ui/file-picker';
import { Input } from '../ui/input';

function SectionCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">{title}</h3>
                <p className="text-xs text-muted mt-1">{hint}</p>
            </div>
            {children}
        </div>
    );
}

function CommunityNameSection({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <SectionCard title="Community Name" hint="Displayed in the header and login page. Max 60 characters.">
            <div className="max-w-md">
                <Field label="Community name" hideLabel hint={`${value.length}/60`}>
                    <Input type="text" maxLength={60} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Raid Ledger" />
                </Field>
            </div>
        </SectionCard>
    );
}

const PRIVACY_CONTACT_HINT = 'Shown on your public privacy page (/privacy). Leave empty to tell members to ask an admin in Discord.';

/** ROK-1778: optional privacy contact email, saved with the community name. */
function PrivacyContactSection({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <SectionCard title="Privacy Contact" hint="Optional. Where members can send privacy questions.">
            <div className="max-w-md">
                <Field label="Privacy contact email" hint={PRIVACY_CONTACT_HINT}>
                    <Input type="email" maxLength={254} value={value} onChange={(e) => onChange(e.target.value)} placeholder="privacy@example.com" />
                </Field>
            </div>
        </SectionCard>
    );
}

function LogoPreview({ logoUrl }: { logoUrl: string | null }) {
    return (
        <div className="w-16 h-16 rounded-lg border border-edge/50 bg-surface/30 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl ? <img src={logoUrl} alt="Community logo" className="w-full h-full object-contain" width={64} height={64} /> : <span className="text-2xl">&#x2694;&#xFE0F;</span>}
        </div>
    );
}

function LogoSection({ logoUrl, onUpload, isUploading }: {
    logoUrl: string | null; onUpload: (files: File[]) => void; isUploading: boolean;
}) {
    return (
        <SectionCard title="Community Logo" hint={LOGO_FORMAT_HINT}>
            <div className="flex items-center gap-4">
                <LogoPreview logoUrl={logoUrl} />
                <FilePicker accept={LOGO_ACCEPT_MIME} onFiles={onUpload} loading={isUploading} loadingLabel="Uploading…" variant="secondary">
                    Upload Logo
                </FilePicker>
            </div>
        </SectionCard>
    );
}

function BrandingPreview({ nameValue, logoUrl }: { nameValue: string; logoUrl: string | null }) {
    return (
        <SectionCard title="Preview" hint="">
            <div className="bg-backdrop/80 rounded-lg border border-edge/30 p-6">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-surface/30">
                        {logoUrl ? <img src={logoUrl} alt="" className="w-full h-full object-contain" width={32} height={32} /> : <span className="text-base">&#x2694;&#xFE0F;</span>}
                    </div>
                    <span className="font-bold text-foreground">{nameValue || 'Raid Ledger'}</span>
                </div>
            </div>
        </SectionCard>
    );
}

function BrandingActions({ hasChanges, onSave, isSaving, onReset, isResetting }: {
    hasChanges: boolean; onSave: () => void; isSaving: boolean; onReset: () => void; isResetting: boolean;
}) {
    return (
        <div className="flex items-center gap-3">
            <Button variant="primary" onClick={onSave} disabled={!hasChanges} loading={isSaving} loadingLabel="Saving…">
                Save Changes
            </Button>
            <Button variant="destructive-soft" onClick={onReset} loading={isResetting} loadingLabel="Resetting…">
                Reset to Defaults
            </Button>
        </div>
    );
}

/**
 * Branding section — community name and logo. The community accent colour was
 * removed (TDB:991): nothing outside this section ever painted with it.
 * Extracted from the former standalone panel (ROK-271).
 */
/** A text field seeded once from the loaded branding, with a "changed" flag. */
function useSeededValue(source: string | null | undefined, ready: boolean) {
    const [value, setValue] = useState('');
    const [initialized, setInitialized] = useState(false);
    if (ready && !initialized) { setValue(source || ''); setInitialized(true); }
    const changed = ready ? value.trim() !== (source || '') : false;
    return { value, setValue, changed };
}

function useBrandingState() {
    const { brandingQuery, updateBranding, uploadLogo, resetBranding } = useBranding();
    const branding = brandingQuery.data;
    const name = useSeededValue(branding?.communityName, !!branding);
    const email = useSeededValue(branding?.privacyContactEmail, !!branding);
    const logoUrl = branding?.communityLogoUrl ? `${API_BASE_URL}${branding.communityLogoUrl}` : null;
    const { setValue: setName } = name;
    const { setValue: setEmail } = email;
    const syncFrom = useCallback((data: { communityName: string | null; privacyContactEmail?: string | null }) => {
        setName(data.communityName || ''); setEmail(data.privacyContactEmail || '');
    }, [setName, setEmail]);

    const handleSave = useCallback(() => {
        const body: BrandingUpdate = {
            ...(name.changed ? { communityName: name.value.trim() } : {}),
            ...(email.changed ? { privacyContactEmail: email.value.trim() } : {}),
        };
        if (Object.keys(body).length === 0) return;
        updateBranding.mutate(body, { onSuccess: syncFrom });
    }, [name.changed, name.value, email.changed, email.value, updateBranding, syncFrom]);

    const handleLogoUpload = useCallback(([file]: File[]) => { if (file) uploadLogo.mutate(file); }, [uploadLogo]);
    const handleReset = useCallback(() => { resetBranding.mutate(undefined, { onSuccess: syncFrom }); }, [resetBranding, syncFrom]);

    return { brandingQuery, name, email, hasChanges: name.changed || email.changed,
        logoUrl, handleSave, handleLogoUpload, handleReset, uploadLogo, updateBranding, resetBranding };
}

/**
 * Branding section -- community name, privacy contact email (ROK-1778) and logo.
 */
export function BrandingSection() {
    const h = useBrandingState();

    if (h.brandingQuery.isLoading) {
        return <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 animate-pulse"><div className="h-4 bg-surface/50 rounded w-1/3" /></div>;
    }

    return (
        <>
            <CommunityNameSection value={h.name.value} onChange={h.name.setValue} />
            <PrivacyContactSection value={h.email.value} onChange={h.email.setValue} />
            <LogoSection logoUrl={h.logoUrl} onUpload={h.handleLogoUpload} isUploading={h.uploadLogo.isPending} />
            <BrandingPreview nameValue={h.name.value} logoUrl={h.logoUrl} />
            <BrandingActions hasChanges={h.hasChanges} onSave={h.handleSave} isSaving={h.updateBranding.isPending} onReset={h.handleReset} isResetting={h.resetBranding.isPending} />
        </>
    );
}
