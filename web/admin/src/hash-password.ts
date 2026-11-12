// Usage: ADMIN_PASSWORD='...' npm run hash-password
// Prints the value for ADMIN_PASSWORD_HASH (terraform variable admin_password_hash).
import { hashPassword } from "./auth.js";

const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12) {
  console.error("Set ADMIN_PASSWORD (at least 12 characters) in the environment.");
  process.exit(1);
}
console.log(hashPassword(password));
