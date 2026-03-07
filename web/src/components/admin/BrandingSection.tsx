import { useState, useRef, useCallback } from 'react';
import { useBranding } from '../../hooks/use-branding';
import { API_BASE_URL } from '../../lib/config';

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

const INPUT_CLASS = 'w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm';

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
            <input type="text" maxLength={60} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Raid Ledger" className={INPUT_CLASS} />
            <p className="text-xs text-dim">{value.length}/60</p>
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

function LogoSection({ logoUrl, onUpload, isUploading, fileInputRef }: {
    logoUrl: string | null; onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; isUploading: boolean;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
    return (
        <SectionCard title="Community Logo" hint="Square image, max 2 MB. PNG, JPEG, WebP, or SVG.">
            <div className="flex items-center gap-4">
                <LogoPreview logoUrl={logoUrl} />
                <div className="flex gap-2">
                    <button onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                        className="px-4 py-2 text-sm font-medium bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground transition-colors disabled:opacity-50">
                        {isUploading ? 'Uploading...' : 'Upload Logo'}
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onUpload} className="hidden" />
                </div>
            </div>
        </SectionCard>
    );
}

function ColorPresets({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map(({ name, hex }) => (
                <button key={hex} onClick={() => onChange(hex)} title={name}
                    className={`w-9 h-9 rounded-lg border-2 transition-all ${value === hex ? 'border-foreground scale-110' : 'border-transparent hover:border-edge'}`}
                    style={{ backgroundColor: hex }} />
            ))}
        </div>
    );
}

function AccentColorSection({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <SectionCard title="Accent Color" hint="Primary accent used for buttons and highlights.">
            <ColorPresets value={value} onChange={onChange} />
            <div className="flex items-center gap-3">
                <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded cursor-pointer border border-edge bg-transparent" />
                <input type="text" value={value} onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value); }}
                    placeholder="#10B981" className="w-28 px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                <div className="w-6 h-6 rounded-full border border-edge/50" style={{ backgroundColor: value }} />
            </div>
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
                <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: colorValue }} disabled>Sample Button</button>
            </div>
        </SectionCard>
    );
}

function BrandingActions({ hasChanges, onSave, isSaving, onReset, isResetting }: {
    hasChanges: boolean; onSave: () => void; isSaving: boolean; onReset: () => void; isResetting: boolean;
}) {
    return (
        <div className="flex items-center gap-3">
            <button onClick={onSave} disabled={!hasChanges || isSaving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors text-sm">
                {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
            <button onClick={onReset} disabled={isResetting}
                className="px-5 py-2.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 font-medium rounded-lg transition-colors text-sm disabled:opacity-50">
                {isResetting ? 'Resetting...' : 'Reset to Defaults'}
            </button>
        </div>
    );
}

/**
 * Branding section — community name, logo, and accent color.
 * Extracted from the former standalone BrandingPanel (ROK-271).
 */
function useBrandingState() {
    const { brandingQuery, updateBranding, uploadLogo, resetBranding } = useBranding();
    const branding = brandingQuery.data;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [nameValue, setNameValue] = useState('');
    const [colorValue, setColorValue] = useState('#10B981');
    const [nameInitialized, setNameInitialized] = useState(false);
    const [colorInitialized, setColorInitialized] = useState(false);

    if (branding && !nameInitialized) { setNameValue(branding.communityName || ''); setNameInitialized(true); }
    if (branding && !colorInitialized) { setColorValue(branding.communityAccentColor || '#10B981'); setColorInitialized(true); }

    const hasNameChange = branding ? nameValue.trim() !== (branding.communityName || '') : false;
    const hasColorChange = branding ? colorValue !== (branding.communityAccentColor || '#10B981') : false;
    const logoUrl = branding?.communityLogoUrl ? `${API_BASE_URL}${branding.communityLogoUrl}` : null;

    const handleSave = useCallback(() => {
        const updates: { communityName?: string; communityAccentColor?: string } = {};
        if (hasNameChange) updates.communityName = nameValue.trim();
        if (hasColorChange) updates.communityAccentColor = colorValue;
        updateBranding.mutate(updates, { onSuccess: (data) => { setNameValue(data.communityName || ''); setColorValue(data.communityAccentColor || '#10B981'); } });
    }, [hasNameChange, hasColorChange, nameValue, colorValue, updateBranding]);

    const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        uploadLogo.mutate(file); if (fileInputRef.current) fileInputRef.current.value = '';
    }, [uploadLogo]);

    const handleReset = useCallback(() => {
        resetBranding.mutate(undefined, { onSuccess: (data) => { setNameValue(data.communityName || ''); setColorValue(data.communityAccentColor || '#10B981'); } });
    }, [resetBranding]);

    return { brandingQuery, nameValue, setNameValue, colorValue, setColorValue, hasNameChange, hasColorChange,
        logoUrl, handleSave, handleLogoUpload, handleReset, fileInputRef, uploadLogo, updateBranding, resetBranding };
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
            <LogoSection logoUrl={h.logoUrl} onUpload={h.handleLogoUpload} isUploading={h.uploadLogo.isPending} fileInputRef={h.fileInputRef} />
            <AccentColorSection value={h.colorValue} onChange={h.setColorValue} />
            <BrandingPreview nameValue={h.nameValue} logoUrl={h.logoUrl} colorValue={h.colorValue} />
            <BrandingActions hasChanges={h.hasNameChange || h.hasColorChange} onSave={h.handleSave} isSaving={h.updateBranding.isPending} onReset={h.handleReset} isResetting={h.resetBranding.isPending} />
        </>
    );
}
