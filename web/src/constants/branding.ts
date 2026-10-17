/**
 * Community-logo upload constraints, shared by every logo uploader so the
 * accept attribute and the human-readable hint can't drift apart (they did:
 * the copy advertised SVG after the backend dropped it in ROK-1292).
 * Must match the validator in api/src/admin/branding.controller.ts.
 */
export const LOGO_ACCEPT_MIME = 'image/png,image/jpeg,image/webp';
export const LOGO_FORMAT_HINT = 'Square image, max 2 MB. PNG, JPEG, or WebP.';
