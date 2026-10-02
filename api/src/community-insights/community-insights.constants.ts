/**
 * Default churn-risk threshold (percent drop vs baseline) used when the
 * admin has not saved one. Shared by the nightly snapshot pipeline and the
 * admin settings endpoint so the two can never disagree.
 */
export const DEFAULT_CHURN_THRESHOLD_PCT = 70;
