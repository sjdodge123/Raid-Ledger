/** Grid position in format 'a1' through 'i4' */
type GridRow = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i';
type GridColumn = '1' | '2' | '3' | '4';
export type GridPosition = `${GridRow}${GridColumn}`;

/** Map from talent slug to grid position within a single talent tree */
export type TreePositionMap = Record<string, GridPosition>;

/** Map from tree name to talent positions for that tree */
export type ClassPositionMap = Record<string, TreePositionMap>;
