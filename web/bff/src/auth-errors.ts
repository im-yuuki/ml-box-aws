// Mapping of Cognito failures to an HTTP status and a public message.
// Kept free of I/O so the mapping can be unit-tested.

export function errorName(error: unknown): string {
  return typeof error === "object" && error && "name" in error ? String(error.name) : "";
}

export function authErrorStatus(error: unknown): number {
  switch (errorName(error)) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
    case "PasswordResetRequiredException":
      return 401;
    case "UserNotConfirmedException":
      return 403;
    case "TooManyRequestsException":
    case "LimitExceededException":
      return 429;
    case "UsernameExistsException":
    case "CodeMismatchException":
    case "ExpiredCodeException":
    case "InvalidPasswordException":
    case "InvalidParameterException":
      return 400;
    default:
      return 502;
  }
}

export function publicError(error: unknown): { error: string; message: string } {
  const name = errorName(error);
  const message =
    name === "UserNotFoundException" || name === "NotAuthorizedException"
      ? "Email hoặc mật khẩu không đúng."
      : name === "UserNotConfirmedException"
        ? "Tài khoản chưa được xác nhận."
        : name === "UsernameExistsException"
          ? "Email này đã được đăng ký."
          : name === "CodeMismatchException"
            ? "Mã xác nhận không đúng."
            : name === "ExpiredCodeException"
              ? "Mã xác nhận đã hết hạn."
              : name === "InvalidPasswordException"
                ? "Mật khẩu chưa đáp ứng chính sách bảo mật."
                : "Không thể hoàn tất yêu cầu xác thực.";
  return { error: name || "AUTH_ERROR", message };
}

/**
 * The confirmation of an already confirmed account raises NotAuthorizedException. The generic
 * mapping blames the email or the password, which is wrong on the verification page, so the
 * confirm route answers with its own code.
 */
export function confirmErrorStatus(error: unknown): number {
  return errorName(error) === "NotAuthorizedException" ? 400 : authErrorStatus(error);
}

export function confirmPublicError(error: unknown): { error: string; message: string } {
  if (errorName(error) === "NotAuthorizedException") {
    return { error: "ALREADY_CONFIRMED", message: "This account is already confirmed." };
  }
  return publicError(error);
}
