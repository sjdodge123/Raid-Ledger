import { Int4IdPipe } from '../../../common/pipes/int4-id.pipe';

/**
 * ROK-1957 — a positive int4 route id (hub, campaign) or 400 'Invalid id'.
 * Same rule as the core `Int4IdPipe`, kept under the plugin's own name.
 */
export class Bg3IdPipe extends Int4IdPipe {}

export const bg3IdPipe = new Bg3IdPipe();
