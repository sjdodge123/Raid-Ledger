/** ROK-1958 D-4 — campaign name rule (1–64 after trimming, `BG3_CAMPAIGN_NAME_MAX`). */
import { BG3_CAMPAIGN_NAME_MAX } from '@raid-ledger/contract';

/** The name error, or null when valid. */
export function bg3CampaignNameError(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'Give the campaign a name.';
    if (trimmed.length > BG3_CAMPAIGN_NAME_MAX) return `Use ${BG3_CAMPAIGN_NAME_MAX} characters or fewer.`;
    return null;
}
