import { useState, useCallback } from 'react';
import { useBranding } from '../../hooks/use-branding';
import { API_BASE_URL } from '../../lib/config';
import { LOGO_ACCEPT_MIME, LOGO_FORMAT_HINT } from '../../constants/branding';
import { Button } from '../ui/button';
import { ColorInput } from '../ui/color-input';
import { Field } from '../ui/field';
import { FilePicker } from '../ui/file-picker';
import { Input } from '../ui/input';

/** Preset accent colors for quick selection */
const PRESET_COLORS = [
    { name: 'Emerald', hex: '#10B981' },
    { name: 'Blue', hex: '#3B82F6' },
    { name: 'Purple', hex: '#8B5CF6' },
    { name: 'Rose', hex: '#F43F5E' },
    { name: 'Amber', hex: '#F59E0B' },
    { name: 'Cyan', hex: '#06B6D4' },
    { name: 'Indigo', hex: '#6366F1' },
    { name: 'Pink', hex: '#EC4899' },
];

const DEFAULT_ACCENT = '#10B981';

/** Hexes compare case-insensitively: presets are uppercase, ColorInput reports lowercase. */
const sameHex = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

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
            {logoUrl ? <img src={logoUrl} alt="Community logo" className="w-full h-full object-contain" /> : <span className="text-2xl">&#x2694;&#xFE0F;</span>}
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

function ColorPresets({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map(({ name, hex }) => {
                const pressed = sameHex(value, hex);
                // The swatch fill is the preset's own colour (brand data), not a theme colour.
                return (
                    <Button key={hex} iconOnly aria-label={name} aria-pressed={pressed} brandColor={hex} onClick={() => onChange(hex)}
                        className={`border-2 ${pressed ? 'border-foreground' : 'border-transparent hover:border-edge'}`} />
                );
            })}
        </div>
    );
}

function AccentColorSection({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <SectionCard title="Accent Color" hint="Primary accent used for buttons and highlights.">
            <ColorPresets value={value} onChange={onChange} />
            <ColorInput label="Accent colour" value={value} onChange={onChange} />
        </SectionCard>
    );
}

function BrandingPreview({ nameValue, logoUrl, colorValue }: { nameValue: string; logoUrl: string | null; colorValue: string }) {
    return (
        <SectionCard title="Preview" hint="">
            <div className="bg-backdrop/80 rounded-lg border border-edge/30 p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-edge/30">
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-surface/30">
                        {logoUrl ? <img src={logoUrl} alt="" className="w-full h-full object-contain" /> : <span className="text-base">&#x2694;&#xFE0F;</span>}
                    </div>
                    <span className="font-bold text-foreground">{nameValue || 'Raid Ledger'}</span>
                </div>
                {/* Not a control: a static sample of the accent fill. data-brand-fill + text-foreground is the
                    index.css forced-white idiom (the Button brandColor precedent), so the label reads light on every scheme. */}
                <span data-brand-fill="" className="inline-flex px-4 py-2 rounded-lg text-sm font-medium text-foreground" style={{ backgroundColor: colorValue }}>
                    Sample Button
                </span>
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
 * Branding section — community name, logo, and accent color.
 * Extracted from the former standalone panel (ROK-271).
 */
function useBrandingState() {
    const { brandingQuery, updateBranding, uploadLogo, resetBranding } = useBranding();
    const branding = brandingQuery.data;
    const [nameValue, setNameValue] = useState('');
    const [colorValue, setColorValue] = useState(DEFAULT_ACCENT);
    const [nameInitialized, setNameInitialized] = useState(false);
    const [colorInitialized, setColorInitialized] = useState(false);

    if (branding && !nameInitialized) { setNameValue(branding.communityName || ''); setNameInitialized(true); }
    if (branding && !colorInitialized) { setColorValue(branding.communityAccentColor || DEFAULT_ACCENT); setColorInitialized(true); }

    const hasNameChange = branding ? nameValue.trim() !== (branding.communityName || '') : false;
    const hasColorChange = branding ? !sameHex(colorValue, branding.communityAccentColor || DEFAULT_ACCENT) : false;
    const logoUrl = branding?.communityLogoUrl ? `${API_BASE_URL}${branding.communityLogoUrl}` : null;

    const handleSave = useCallback(() => {
        const updates: { communityName?: string; communityAccentColor?: string } = {};
        if (hasNameChange) updates.communityName = nameValue.trim();
        if (hasColorChange) updates.communityAccentColor = colorValue;
        updateBranding.mutate(updates, { onSuccess: (data) => { setNameValue(data.communityName || ''); setColorValue(data.communityAccentColor || DEFAULT_ACCENT); } });
    }, [hasNameChange, hasColorChange, nameValue, colorValue, updateBranding]);

    const handleLogoUpload = useCallback(([file]: File[]) => { if (file) uploadLogo.mutate(file); }, [uploadLogo]);

    const handleReset = useCallback(() => {
        resetBranding.mutate(undefined, { onSuccess: (data) => { setNameValue(data.communityName || ''); setColorValue(data.communityAccentColor || DEFAULT_ACCENT); } });
    }, [resetBranding]);

    return { brandingQuery, nameValue, setNameValue, colorValue, setColorValue, hasNameChange, hasColorChange,
        logoUrl, handleSave, handleLogoUpload, handleReset, uploadLogo, updateBranding, resetBranding };
}

/**
 * Branding section -- community name, logo, and accent color.
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
            <AccentColorSection value={h.colorValue} onChange={h.setColorValue} />
            <BrandingPreview nameValue={h.nameValue} logoUrl={h.logoUrl} colorValue={h.colorValue} />
            <BrandingActions hasChanges={h.hasNameChange || h.hasColorChange} onSave={h.handleSave} isSaving={h.updateBranding.isPending} onReset={h.handleReset} isResetting={h.resetBranding.isPending} />
        </>
    );
}
