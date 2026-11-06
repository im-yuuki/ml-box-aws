import { redirect } from "next/navigation";

// Quota is a settings page of its own now.
export default function UsageRedirect() {
  redirect("/account/quota");
}
