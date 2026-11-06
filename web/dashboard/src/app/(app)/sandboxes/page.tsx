import { redirect } from "next/navigation";

// Sandboxes now live on the unified Projects page (each Project owns its runtime).
export default function SandboxesRedirect() {
  redirect("/projects");
}
