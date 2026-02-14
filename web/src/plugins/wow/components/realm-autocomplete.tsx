import { useState, useRef, useEffect, useMemo } from 'react';
import { useWowRealms } from '../hooks/use-wow-realms';

interface RealmAutocompleteProps {
    region: string;
    value: string;
    onChange: (realm: string) => void;
    /** WoW game variant for Blizzard API namespace (retail, classic_era, classic) */
    gameVariant?: string;
}

/**
 * Autocomplete input for WoW realm names (ROK-234 UX).
 * Fetches realm list from Blizzard API and filters client-side.
 */
export function RealmAutocomplete({ region, value, onChange, gameVariant }: RealmAutocompleteProps) {
    const { data } = useWowRealms(region, gameVariant);

    const [isOpen, setIsOpen] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    // Filter realms based on current input
    const filtered = useMemo(() => {
        const realms = data?.data ?? [];
        if (!value.trim()) return realms.slice(0, 20);
        const lower = value.toLowerCase();
        return realms.filter((r) => r.name.toLowerCase().includes(lower)).slice(0, 20);
    }, [data, value]);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    function handleSelect(realmName: string) {
        onChange(realmName);
        setIsOpen(false);
        setHighlightIndex(-1);
        inputRef.current?.blur();
    }

    function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        onChange(e.target.value);
        setIsOpen(true);
        setHighlightIndex(-1);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (!isOpen || filtered.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(highlightIndex + 1, filtered.length - 1);
            setHighlightIndex(next);
            listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.max(highlightIndex - 1, 0);
            setHighlightIndex(next);
            listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && highlightIndex >= 0) {
            e.preventDefault();
            handleSelect(filtered[highlightIndex].name);
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    }

    const showDropdown = isOpen && filtered.length > 0;

    return (
        <div className="relative" ref={containerRef}>
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder="Realm Name"
                    maxLength={100}
                    className="w-full px-3 py-2 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    autoComplete="off"
                />
                <svg
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>

            {showDropdown && (
                <div className="absolute z-50 w-full mt-1 bg-surface border border-edge rounded-lg shadow-2xl overflow-hidden">
                    {/* Header row */}
                    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-edge bg-panel">
                        <span className="text-secondary text-xs font-bold uppercase tracking-wider">Status</span>
                        <span className="text-secondary text-xs font-bold uppercase tracking-wider flex-1">Realm Name</span>
                    </div>

                    {/* Realm list */}
                    <ul
                        ref={listRef}
                        className="max-h-48 overflow-y-auto"
                        role="listbox"
                    >
                        {filtered.map((realm, i) => (
                            <li
                                key={realm.id}
                                role="option"
                                aria-selected={i === highlightIndex}
                                onClick={() => handleSelect(realm.name)}
                                className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm transition-colors border-b border-edge/30 ${i === highlightIndex
                                    ? 'bg-blue-600/20 text-blue-300'
                                    : i % 2 === 0
                                        ? 'bg-surface text-foreground hover:bg-panel'
                                        : 'bg-panel/50 text-foreground hover:bg-panel'
                                    }`}
                            >
                                {/* Status dot */}
                                <span className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0 shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
                                <span className="truncate">{realm.name}</span>
                            </li>
                        ))}
                    </ul>

                    {/* Footer — result count */}
                    <div className="px-3 py-1 border-t border-edge bg-panel">
                        <span className="text-[10px] text-muted">
                            {filtered.length} realm{filtered.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
