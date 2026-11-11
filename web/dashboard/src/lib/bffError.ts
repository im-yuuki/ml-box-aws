/**
 * The BFF answers with a machine-readable `error` code and a message that is only written in one
 * language. The dashboard shows its own localized text, so an English UI never shows a Vietnamese
 * sentence.
 */
const CODE_TO_MESSAGE: Record<string, string> = {
  // Cognito auth errors (the BFF passes the exception name through).
  NotAuthorizedException: "invalidCredentials",
  UserNotFoundException: "invalidCredentials",
  PasswordResetRequiredException: "passwordResetRequired",
  UserNotConfirmedException: "accountNotConfirmed",
  UsernameExistsException: "emailAlreadyUsed",
  CodeMismatchException: "invalidCode",
  ExpiredCodeException: "expiredCode",
  InvalidPasswordException: "passwordPolicy",
  TooManyRequestsException: "tooManyAttempts",
  LimitExceededException: "tooManyAttempts",
  InvalidParameterException: "invalidInput",
  // BFF codes.
  INVALID_INPUT: "invalidInput",
  INVALID_ROLE: "invalidRole",
  TURNSTILE_REQUIRED: "turnstileRequired",
  APP_DATABASE_UNAVAILABLE: "serviceUnavailable",
  ARTIFACTS_NOT_CONFIGURED: "serviceUnavailable",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  UNAUTHENTICATED: "sessionExpired",
  AUTH_CHALLENGE_REQUIRED: "authChallengeRequired",
  QUOTA_EXCEEDED: "quotaExceeded",
  GPU_NOT_IN_PLAN: "gpuNotInPlan",
  CREDITS_EXHAUSTED: "quotaExceeded",
  PROJECT_OWNER_NOT_READY: "ownerNotReady",
  SANDBOX_ALREADY_RUNNING: "alreadyRunning",
  SANDBOX_START_FAILED: "sandboxStartFailed",
  ARTIFACTS_DISABLED: "artifactsDisabled",
  CONFIRMATION_REQUIRED: "confirmationRequired",
  ALREADY_CONFIRMED: "alreadyConfirmed",
  MEMBER_LIMIT_REACHED: "memberLimitReached",
};

export type BffErrorBody = { error?: string; message?: string };

/** The i18n key for a BFF error code, or null when the code is unknown. */
export function bffErrorKey(body: BffErrorBody | null | undefined): string | null {
  const code = body?.error;
  if (!code) return null;
  return CODE_TO_MESSAGE[code] ?? null;
}
