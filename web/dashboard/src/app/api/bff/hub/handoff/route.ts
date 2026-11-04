import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

// Mints a one-time Hub login URL for the signed-in user (see BFF /v1/hub/handoff).
export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyBff(request, "/v1/hub/handoff", { method: "POST", body: body || "{}" });
}
