import { redirect } from "next/navigation";

// Runtimes are started from a Project; there is no standalone sandbox creation.
export default function NewSandboxRedirect() {
  redirect("/projects");
}
