import assert from "node:assert/strict";
import test from "node:test";
import { authErrorStatus, confirmErrorStatus, confirmPublicError, publicError } from "./auth-errors.js";

function cognitoError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

test("login still blames the email or password for a wrong credential", () => {
  assert.equal(authErrorStatus(cognitoError("NotAuthorizedException")), 401);
  assert.equal(authErrorStatus(cognitoError("UserNotFoundException")), 401);
  assert.equal(publicError(cognitoError("NotAuthorizedException")).error, "NotAuthorizedException");
});

test("confirming an already confirmed account has its own code", () => {
  const error = cognitoError("NotAuthorizedException");

  assert.equal(confirmErrorStatus(error), 400);
  assert.deepEqual(confirmPublicError(error), {
    error: "ALREADY_CONFIRMED",
    message: "This account is already confirmed.",
  });
});

test("other confirmation failures keep the generic mapping", () => {
  const mismatch = cognitoError("CodeMismatchException");

  assert.equal(confirmErrorStatus(mismatch), 400);
  assert.deepEqual(confirmPublicError(mismatch), {
    error: "CodeMismatchException",
    message: "Mã xác nhận không đúng.",
  });
  assert.equal(confirmErrorStatus(cognitoError("UserNotFoundException")), 401);
});
