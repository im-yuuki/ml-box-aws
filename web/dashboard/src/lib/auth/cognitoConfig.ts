/**
 * Cognito client config for the server-side dashboard helpers.
 *
 * These variables are deliberately NOT `NEXT_PUBLIC_*`: Next.js inlines those
 * into the JS bundle at build time, which would bake one AWS account into the
 * image. Without the prefix they are read from the process environment when the
 * container starts, so the same image runs in any account.
 *
 * The dashboard uses a public Cognito app client (no client secret). Browser
 * authentication goes through the same-origin BFF; Cognito tokens never reach
 * the browser.
 */
export const cognitoConfig = {
  region: process.env.COGNITO_REGION ?? "ap-southeast-2",
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.COGNITO_CLIENT_ID ?? "",
  /** Where the BFF is reachable from the browser. Same origin by default. */
  bffBaseUrl: process.env.BFF_PUBLIC_BASE_URL ?? "/api/bff",
} as const;

/** True once the env has been populated. Use to gate the auth UI. */
export const cognitoConfigured =
  cognitoConfig.userPoolId !== "" && cognitoConfig.clientId !== "";
