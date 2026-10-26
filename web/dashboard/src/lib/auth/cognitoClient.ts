/**
 * Legacy low-level Cognito request helper.
 *
 * Dashboard authentication is handled by the server-side BFF so browser
 * code never stores Cognito tokens. Keep this helper isolated for diagnostics
 * or future flows; application UI should call the same-origin BFF routes.
 */
import { cognitoConfig } from "./cognitoConfig";

type CognitoError = { __type: string; message: string };

export function cognitoEndpoint(): string {
  return `https://cognito-idp.${cognitoConfig.region}.amazonaws.com/`;
}

export async function cognitoRequest<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(cognitoEndpoint(), {
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
