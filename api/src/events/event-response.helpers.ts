/**
 * Re-exports for event response helpers.
 *
 * Consumers import from this barrel file; actual logic lives in:
 *   - event-response-map.helpers.ts (mapEventToResponse, buildLifecyclePayload)
 *   - event-response-signups.helpers.ts (getSignupsPreviewForEvents)
 *   - event-response-embed.helpers.ts (buildEmbedEventData)
 *   - event-response-variant.helpers.ts (getVariantContext)
 */
export {
  mapEventToResponse,
  buildLifecyclePayload,
} from './event-response-map.helpers';
export { getSignupsPreviewForEvents } from './event-response-signups.helpers';
export { buildEmbedEventData } from './event-response-embed.helpers';
export { getVariantContext } from './event-response-variant.helpers';
