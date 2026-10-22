/**
 * Tiny client-side wrapper around the Cognito Identity Provider API.
 *
 * We don't pull in the full `aws-amplify` SDK for the small surface we need
 * (sign up, confirm sign up, SRP-respond, forgot password, get session).
 * All endpoints are public POSTs documented at
 * https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_Operations.html
 *
 * The SRP flow is the only one that requires crypto: Cognito expects the
 * client to compute `PASSWORD_CLAIM_SIGNATURE` and the auth challenge
 * responses. For now we keep the helper minimal and let the dashboard fall
 * back to a server-proxied login if the env is unconfigured.
 */
import { cognitoConfig } from "./cognitoConfig";

type CognitoError = { __type: string; message: string };

export function cognitoEndpoint(action: string): string {
  return `https://cognito-idp.${cognitoConfig.region}.amazonaws.com/`;
}

export function userPoolEndpoint(action: string): string {
  // Same endpoint for every action; the action goes in the X-Amz-Target header.
  return cognitoEndpoint(action);
}

export async function cognitoRequest<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(cognitoEndpoint(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      ...headers,
    },
    body: JSON.stringify({
      ClientId: cognitoConfig.clientId,
      ...payload,
    }),
  });
  if (!res.ok) {
    let err: CognitoError | null = null;
    try {
      err = (await res.json()) as CognitoError;
    } catch {
      /* non-JSON error */
    }
    throw new Error(
      err?.message ?? `Cognito ${action} failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

/** Stub session type. The BFF issues the real session cookie after auth. */
export type DashboardSession = {
  user: { email: string };
  accessToken: string;
  idToken: string;
  expiresAt: number;
};
