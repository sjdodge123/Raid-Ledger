/** "1 point" / "2 points" — the count and a noun agreeing with it (ROK-1758). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}
