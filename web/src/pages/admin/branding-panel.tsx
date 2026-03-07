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

/**
 * Appearance > Branding panel (ROK-271).
 * Full UI for community name, logo upload, and accent color selection.
 */
const DEFAULT_COLOR = '#10B981';

function useBrandingForm(branding: { communityName?: string | null; communityAccentColor?: string | null } | undefined) {
    const [nameValue, setNameValue] = useState('');
    const [colorValue, setColorValue] = useState(DEFAULT_COLOR);
    const [nameInit, setNameInit] = useState(false);
    const [colorInit, setColorInit] = useState(false);

    if (branding && !nameInit) { setNameValue(branding.communityName || ''); setNameInit(true); }
    if (branding && !colorInit) { setColorValue(branding.communityAccentColor || DEFAULT_COLOR); setColorInit(true); }

    const hasNameChange = branding ? nameValue.trim() !== (branding.communityName || '') : false;
    const hasColorChange = branding ? colorValue !== (branding.communityAccentColor || DEFAULT_COLOR) : false;
    const syncFromResponse = useCallback((data: { communityName?: string | null; communityAccentColor?: string | null }) => {
        setNameValue(data.communityName || ''); setColorValue(data.communityAccentColor || DEFAULT_COLOR);
    }, []);

    return { nameValue, setNameValue, colorValue, setColorValue, hasNameChange, hasColorChange, syncFromResponse };
}

export function BrandingPanel() {
    const { brandingQuery, updateBranding, uploadLogo, resetBranding } = useBranding();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { nameValue, setNameValue, colorValue, setColorValue, hasNameChange, hasColorChange, syncFromResponse } = useBrandingForm(brandingQuery.data);

    const handleSave = useCallback(() => {
        const updates: { communityName?: string; communityAccentColor?: string } = {};
        if (hasNameChange) updates.communityName = nameValue.trim();
        if (hasColorChange) updates.communityAccentColor = colorValue;
        updateBranding.mutate(updates, { onSuccess: syncFromResponse });
    }, [hasNameChange, hasColorChange, nameValue, colorValue, updateBranding, syncFromResponse]);

    const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        uploadLogo.mutate(file); if (fileInputRef.current) fileInputRef.current.value = '';
    }, [uploadLogo]);

    const logoUrl = brandingQuery.data?.communityLogoUrl ? `${API_BASE_URL}${brandingQuery.data.communityLogoUrl}` : null;
    if (brandingQuery.isLoading) return <BrandingLoading />;

    return (
        <div className="space-y-6">
            <div><h2 className="text-xl font-semibold text-foreground">Branding</h2><p className="text-sm text-muted mt-1">Customize your community name, logo, and accent color.</p></div>
            <CommunityNameSection nameValue={nameValue} onNameChange={setNameValue} />
            <LogoSection logoUrl={logoUrl} isUploading={uploadLogo.isPending} fileInputRef={fileInputRef} onUpload={handleLogoUpload} />
            <AccentColorSection colorValue={colorValue} onColorChange={setColorValue} />
            <BrandingPreview logoUrl={logoUrl} nameValue={nameValue} colorValue={colorValue} />
            <BrandingActions hasChanges={hasNameChange || hasColorChange} isSaving={updateBranding.isPending}
                isResetting={resetBranding.isPending} onSave={handleSave} onReset={() => resetBranding.mutate(undefined, { onSuccess: syncFromResponse })} />
        </div>
    );
}

function BrandingLoading() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Branding</h2>
                <p className="text-sm text-muted mt-1">Customize your community name, logo, and accent color.</p>
            </div>
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 animate-pulse">
                <div className="h-4 bg-surface/50 rounded w-1/3" />
            </div>
        </div>
    );
}

function CommunityNameSection({ nameValue, onNameChange }: { nameValue: string; onNameChange: (v: string) => void }) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Community Name</h3>
                <p className="text-xs text-muted mt-1">Displayed in the header and login page. Max 60 characters.</p>
            </div>
            <input type="text" maxLength={60} value={nameValue} onChange={(e) => onNameChange(e.target.value)} placeholder="Raid Ledger"
                className="w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm" />
            <p className="text-xs text-dim">{nameValue.length}/60</p>
        </div>
    );
}

function LogoSection({ logoUrl, isUploading, fileInputRef, onUpload }: {
    logoUrl: string | null; isUploading: boolean;
    fileInputRef: React.RefObject<HTMLInputElement | null>; onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Community Logo</h3>
                <p className="text-xs text-muted mt-1">Square image, max 2 MB. PNG, JPEG, WebP, or SVG.</p>
            </div>
            <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-lg border border-edge/50 bg-surface/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {logoUrl ? <img src={logoUrl} alt="Community logo" className="w-full h-full object-contain" /> : <span className="text-2xl">&#x2694;&#xFE0F;</span>}
                </div>
                <div className="flex gap-2">
                    <button onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                        className="px-4 py-2 text-sm font-medium bg-surface/50 hover:bg-surface border border-edge rounded-lg text-foreground transition-colors disabled:opacity-50">
                        {isUploading ? 'Uploading...' : 'Upload Logo'}
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onUpload} className="hidden" />
                </div>
            </div>
        </div>
    );
}

function AccentColorSection({ colorValue, onColorChange }: { colorValue: string; onColorChange: (v: string) => void }) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Accent Color</h3>
                <p className="text-xs text-muted mt-1">Primary accent used for buttons and highlights.</p>
            </div>
            <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map(({ name, hex }) => (
                    <button key={hex} onClick={() => onColorChange(hex)} title={name}
                        className={`w-9 h-9 rounded-lg border-2 transition-all ${colorValue === hex ? 'border-foreground scale-110' : 'border-transparent hover:border-edge'}`}
                        style={{ backgroundColor: hex }} />
                ))}
            </div>
            <div className="flex items-center gap-3">
                <input type="color" value={colorValue} onChange={(e) => onColorChange(e.target.value)} className="w-10 h-10 rounded cursor-pointer border border-edge bg-transparent" />
                <input type="text" value={colorValue} onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onColorChange(e.target.value); }}
                    placeholder="#10B981" className="w-28 px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                <div className="w-6 h-6 rounded-full border border-edge/50" style={{ backgroundColor: colorValue }} />
            </div>
        </div>
    );
}

function BrandingPreview({ logoUrl, nameValue, colorValue }: { logoUrl: string | null; nameValue: string; colorValue: string }) {
    return (
        <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Preview</h3>
            <div className="bg-backdrop/80 rounded-lg border border-edge/30 p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-edge/30">
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-surface/30">
                        {logoUrl ? <img src={logoUrl} alt="" className="w-full h-full object-contain" /> : <span className="text-base">&#x2694;&#xFE0F;</span>}
                    </div>
                    <span className="font-bold text-foreground">{nameValue || 'Raid Ledger'}</span>
                </div>
                <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: colorValue }} disabled>Sample Button</button>
            </div>
        </div>
    );
}

function BrandingActions({ hasChanges, isSaving, isResetting, onSave, onReset }: {
    hasChanges: boolean; isSaving: boolean; isResetting: boolean; onSave: () => void; onReset: () => void;
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
