/**
 * ROK-1597: Microsoft identity platform v2.0 + Graph v1.0 constants (spec
 * §3.1). The `common` tenant accepts personal and work/school accounts.
 * Read-mask and copy-property constants are added by the read (7a-2) and
 * write (7b-1) layers that own them.
 */

const MS_LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export const MS_AUTHORIZE_URL = `${MS_LOGIN}/authorize`;
export const MS_TOKEN_URL = `${MS_LOGIN}/token`;
export const GRAPH_API = 'https://graph.microsoft.com/v1.0';
/** Prefix a token-endpoint `scope` echo may carry on Graph scopes. */
export const GRAPH_SCOPE_PREFIX = 'https://graph.microsoft.com/';

/** The one scope that covers calendar read AND write (ROK-669 §4.2). */
export const MS_CALENDAR_SCOPE = 'Calendars.ReadWrite';
/** The RULED connect scope set — nothing else (no `openid`). */
export const MS_SCOPES: readonly string[] = [
  'offline_access',
  'User.Read',
  MS_CALENDAR_SCOPE,
];
/** Scopes a grant must hold to be stored (`offline_access` is judged by
 * the presence of a refresh token, since its echo is unreliable). */
export const MS_REQUIRED_SCOPES: readonly string[] = [MS_CALENDAR_SCOPE];

/** Graph returns every dateTime in UTC with this `Prefer` value. */
export const PREFER_UTC = 'outlook.timezone="UTC"';
/** Stable event ids across folder moves. */
export const PREFER_IMMUTABLE_ID = 'IdType="ImmutableId"';

/** `/me` projection: the stable id plus the two possible labels. */
export const MS_ME_URL = `${GRAPH_API}/me?$select=id,mail,userPrincipalName`;
