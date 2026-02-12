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
export function BrandingPanel() {
    const { brandingQuery, updateBranding, uploadLogo, resetBranding } = useBranding();
    const branding = brandingQuery.data;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [nameValue, setNameValue] = useState('');
    const [colorValue, setColorValue] = useState('#10B981');
    const [nameInitialized, setNameInitialized] = useState(false);
    const [colorInitialized, setColorInitialized] = useState(false);

    // Sync from server once data loads
    if (branding && !nameInitialized) {
        setNameValue(branding.communityName || '');
        setNameInitialized(true);
    }
    if (branding && !colorInitialized) {
        setColorValue(branding.communityAccentColor || '#10B981');
        setColorInitialized(true);
    }

    const hasNameChange = branding
        ? nameValue.trim() !== (branding.communityName || '')
        : false;
    const hasColorChange = branding
        ? colorValue !== (branding.communityAccentColor || '#10B981')
        : false;
    const hasChanges = hasNameChange || hasColorChange;

    const handleSave = useCallback(() => {
        const updates: { communityName?: string; communityAccentColor?: string } = {};
        if (hasNameChange) updates.communityName = nameValue.trim();
        if (hasColorChange) updates.communityAccentColor = colorValue;
        updateBranding.mutate(updates, {
            onSuccess: () => {
                setNameInitialized(false);
                setColorInitialized(false);
            },
        });
    }, [hasNameChange, hasColorChange, nameValue, colorValue, updateBranding]);

    const handleLogoUpload = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            uploadLogo.mutate(file, {
                onSuccess: () => {
                    setNameInitialized(false);
                    setColorInitialized(false);
                },
            });
            // Reset input so the same file can be re-selected
            if (fileInputRef.current) fileInputRef.current.value = '';
        },
        [uploadLogo],
    );

    const handleReset = useCallback(() => {
        resetBranding.mutate(undefined, {
            onSuccess: () => {
                setNameValue('');
                setColorValue('#10B981');
                setNameInitialized(false);
                setColorInitialized(false);
            },
        });
    }, [resetBranding]);

    const logoUrl = branding?.communityLogoUrl
        ? `${API_BASE_URL}${branding.communityLogoUrl}`
        : null;

    if (brandingQuery.isLoading) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold text-foreground">Branding</h2>
                    <p className="text-sm text-muted mt-1">
                        Customize your community name, logo, and accent color.
                    </p>
                </div>
                <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 animate-pulse">
                    <div className="h-4 bg-surface/50 rounded w-1/3" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-xl font-semibold text-foreground">Branding</h2>
                <p className="text-sm text-muted mt-1">
                    Customize your community name, logo, and accent color.
                </p>
            </div>

            {/* Community Name */}
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Community Name
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        Displayed in the header and login page. Max 60 characters.
                    </p>
                </div>
                <input
                    type="text"
                    maxLength={60}
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    placeholder="Raid Ledger"
                    className="w-full max-w-md px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm"
                />
                <p className="text-xs text-dim">{nameValue.length}/60</p>
            </div>

            {/* Community Logo */}
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Community Logo
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        Square image, max 2 MB. PNG, JPEG, WebP, or SVG.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    {/* Current logo preview */}
                    <div className="w-16 h-16 rounded-lg border border-edge/50 bg-surface/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {logoUrl ? (
                            <img
                                src={logoUrl}
                                alt="Community logo"
                                className="w-full h-full object-contain"
                            />
                        ) : (
                            <span className="text-2xl">&#x2694;&#xFE0F;</span>
                        )}
                    </div>

                    <div className="flex gap-2">
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
            </div>

            {/* Accent Color */}
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                        Accent Color
                    </h3>
                    <p className="text-xs text-muted mt-1">
                        Primary accent used for buttons and highlights.
                    </p>
                </div>

                {/* Preset palette */}
                <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map(({ name, hex }) => (
                        <button
                            key={hex}
                            onClick={() => setColorValue(hex)}
                            title={name}
                            className={`w-9 h-9 rounded-lg border-2 transition-all ${
                                colorValue === hex
                                    ? 'border-foreground scale-110'
                                    : 'border-transparent hover:border-edge'
                            }`}
                            style={{ backgroundColor: hex }}
                        />
                    ))}
                </div>

                {/* Custom color input */}
                <div className="flex items-center gap-3">
                    <input
                        type="color"
                        value={colorValue}
                        onChange={(e) => setColorValue(e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer border border-edge bg-transparent"
                    />
                    <input
                        type="text"
                        value={colorValue}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setColorValue(v);
                        }}
                        placeholder="#10B981"
                        className="w-28 px-3 py-2 bg-surface/50 border border-edge rounded-lg text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <div
                        className="w-6 h-6 rounded-full border border-edge/50"
                        style={{ backgroundColor: colorValue }}
                    />
                </div>
            </div>

            {/* Live Preview */}
            <div className="bg-panel/50 rounded-xl border border-edge/50 p-6 space-y-4">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                    Preview
                </h3>
                <div className="bg-backdrop/80 rounded-lg border border-edge/30 p-6">
                    {/* Mock header */}
                    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-edge/30">
                        <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-surface/30">
                            {logoUrl ? (
                                <img src={logoUrl} alt="" className="w-full h-full object-contain" />
                            ) : (
                                <span className="text-base">&#x2694;&#xFE0F;</span>
                            )}
                        </div>
                        <span className="font-bold text-foreground">
                            {nameValue || 'Raid Ledger'}
                        </span>
                    </div>
                    {/* Mock button with accent */}
                    <button
                        className="px-4 py-2 rounded-lg text-white text-sm font-medium"
                        style={{ backgroundColor: colorValue }}
                        disabled
                    >
                        Sample Button
                    </button>
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
                <button
                    onClick={handleSave}
                    disabled={!hasChanges || updateBranding.isPending}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-foreground font-semibold rounded-lg transition-colors text-sm"
                >
                    {updateBranding.isPending ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                    onClick={handleReset}
                    disabled={resetBranding.isPending}
                    className="px-5 py-2.5 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
                >
                    {resetBranding.isPending ? 'Resetting...' : 'Reset to Defaults'}
                </button>
            </div>
        </div>
    );
}
