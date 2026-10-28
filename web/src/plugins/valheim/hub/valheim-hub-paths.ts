/**
 * ROK-2029 — the `hubPath` router state the character page's "<server> · Characters"
 * crumb returns to: the hub URL the viewer is on (search kept) at the Characters tab.
 * Shared by the Characters tab rows and the Overview Deaths card name links.
 */
export const charactersTabHubPath = (pathname: string, search: string): string => `${pathname}${search}#characters`;
