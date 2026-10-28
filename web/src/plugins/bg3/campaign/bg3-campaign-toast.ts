/**
 * ROK-1958 — campaign write errors → one clear toast. The api answers 400
 * `campaign_archived` when a settings / default PUT names an archived campaign.
 */
import { errorBodyOf } from '../../../lib/api/api-error';
import { toast } from '../../../lib/toast';

export const BG3_CAMPAIGN_ARCHIVED_TOAST = 'That campaign is archived. Unarchive it first, or pick another one.';

export function isBg3CampaignArchived(error: unknown): boolean {
    return errorBodyOf(error)?.['message'] === 'campaign_archived';
}

/** `fallback` names the failed action ("Couldn't start the campaign."). */
export function toastBg3CampaignError(error: unknown, fallback: string): void {
    toast.error(isBg3CampaignArchived(error) ? BG3_CAMPAIGN_ARCHIVED_TOAST : fallback);
}
