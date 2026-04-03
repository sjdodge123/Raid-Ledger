/** Session key for wizard skip preference (ROK-999). */
const SESSION_KEY = 'scheduling-wizard-skipped';

/** Check sessionStorage for skip preference. */
export function isWizardSkipped(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
}

/** Persist skip preference in sessionStorage. */
export function setWizardSkipped(): void {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private browsing */ }
}
