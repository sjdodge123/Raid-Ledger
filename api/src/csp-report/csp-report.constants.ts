/**
 * Route segment of the CSP violation report endpoint. Shared by the
 * controller and the CORS policy's exemption (ROK-1732) so the two can never
 * drift apart. nginx's `report-uri /api/csp-report` strips `/api`, so Node
 * sees `/csp-report`.
 */
export const CSP_REPORT_ROUTE = 'csp-report';
