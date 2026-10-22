/**
 * Cognito client config surfaced to the browser.
 *
 * The dashboard uses a public Cognito app client (no client secret) with
 * SRP auth so users can sign in / sign up / reset password from the dashboard
 * itself — no hosted UI redirect.
 *
 * Wire the values through Next.js env at build time so this module stays
 * tree-shakeable on the client.  Fill in `terraform/stacks/04-dashboard/`
 * outputs when the stack is added; defaults are placeholders so the app
 * still renders without a backend.
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
