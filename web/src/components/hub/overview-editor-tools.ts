/**
 * ROK-1918 L5 — the Overview's editor-only tools, behind ONE dynamic import.
 * Every `import()` call site in the `hub-page` chunk carries its own ~95-entry
 * `__vite__mapDeps` preload list (~0.5 KB gz); a second call site for arrange
 * mode put the route over its gzip budget. `HubOverview` loads both the setup
 * checklist and arrange gate through `loadOverviewEditorTools`, so members
 * download neither and the route chunk gains no new preload list.
 */
export { HubSetupChecklist } from './onboarding/setup-checklist';
export { HubArrangeGate } from './arrange/hub-arrange-gate';

/**
 * ROK-1918 L6 — the arrange-list pieces the `/dev/design-system` demo reuses.
 * Importing them from their own files would make Rollup split them into a
 * shared chunk, which adds a path to this loader's preload list in `hub-page`
 * (measured: 12.8 → 12.9 KB gz). Through here the demo just depends on this chunk.
 */
export { ArrangeRow } from './arrange/arrange-row';
export { moveAnnouncement, moveRow, moveTo, toggleRow } from './arrange/arrange-draft';
export { DRAG_MQ, useRowDrag } from './arrange/use-row-drag';
