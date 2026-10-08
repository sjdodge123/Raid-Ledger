import { useState, useCallback } from 'react';
import { useBranding } from '../../hooks/use-branding';
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
function useBrandingState() {
    const { brandingQuery, updateBranding, uploadLogo, resetBranding } = useBranding();
    const branding = brandingQuery.data;
    const [nameValue, setNameValue] = useState('');
    const [nameInitialized, setNameInitialized] = useState(false);

    if (branding && !nameInitialized) { setNameValue(branding.communityName || ''); setNameInitialized(true); }

    const hasNameChange = branding ? nameValue.trim() !== (branding.communityName || '') : false;
    const logoUrl = branding?.communityLogoUrl ? `${API_BASE_URL}${branding.communityLogoUrl}` : null;

    const handleSave = useCallback(() => {
        if (!hasNameChange) return;
        updateBranding.mutate({ communityName: nameValue.trim() }, { onSuccess: (data) => setNameValue(data.communityName || '') });
    }, [hasNameChange, nameValue, updateBranding]);

    const handleLogoUpload = useCallback(([file]: File[]) => { if (file) uploadLogo.mutate(file); }, [uploadLogo]);

    const handleReset = useCallback(() => {
        resetBranding.mutate(undefined, { onSuccess: (data) => setNameValue(data.communityName || '') });
    }, [resetBranding]);

    return { brandingQuery, nameValue, setNameValue, hasNameChange,
        logoUrl, handleSave, handleLogoUpload, handleReset, uploadLogo, updateBranding, resetBranding };
}

/**
 * Branding section -- community name and logo.
 */
export function BrandingSection() {
    const h = useBrandingState();

    if (h.brandingQuery.isLoading) {
        return <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 animate-pulse"><div className="h-4 bg-surface/50 rounded w-1/3" /></div>;
    }

    return (
        <>
            <CommunityNameSection value={h.nameValue} onChange={h.setNameValue} />
            <LogoSection logoUrl={h.logoUrl} onUpload={h.handleLogoUpload} isUploading={h.uploadLogo.isPending} />
            <BrandingPreview nameValue={h.nameValue} logoUrl={h.logoUrl} />
            <BrandingActions hasChanges={h.hasNameChange} onSave={h.handleSave} isSaving={h.updateBranding.isPending} onReset={h.handleReset} isResetting={h.resetBranding.isPending} />
        </>
    );
}
