import { NextResponse } from "next/server";

/**
 * BFF stub: list user sandboxes (proxies JupyterHub /hub/api/users/{name}/servers).
 */
export async function GET() {
  return NextResponse.json(
    {
      error: "BFF_NOT_DEPLOYED",
      message: "Sandbox listing will come from the BFF → hub API proxy.",
    },
    { status: 501 },
  );
}
