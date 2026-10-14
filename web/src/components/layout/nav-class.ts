/** Desktop header link class; `current === target` gets the active colour. Shared with plugin nav fillers (ROK-1785). */
export function navClass(current: string, target: string): string {
    return `font-medium transition-colors ${current === target ? 'text-emerald-400' : 'text-secondary hover:text-foreground'}`;
}
