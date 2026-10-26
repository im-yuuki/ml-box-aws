/**
 * Cognito client config surfaced to the browser.
 *
 * The dashboard uses a public Cognito app client (no client secret) so the
 * browser can be configured for the deployed user pool. Authentication
 * requests are sent to the same-origin BFF; Cognito tokens never enter the
 * browser session or a build argument.
 *
 * These public identifiers are embedded at Next.js build time. Empty defaults
 * keep local UI previews usable, while the production image must receive the
 * values from the 02-platform outputs.
 */
export const cognitoConfig = {
  region: process.env.NEXT_PUBLIC_COGNITO_REGION ?? "ap-southeast-2",
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "",
  /** Where the BFF is reachable from the browser. Same origin in production. */
  bffBaseUrl: process.env.NEXT_PUBLIC_BFF_BASE_URL ?? "/api/bff",
} as const;

/** True once the env has been populated. Use to gate the auth UI. */
export const cognitoConfigured =
  cognitoConfig.userPoolId !== "" && cognitoConfig.clientId !== "";
