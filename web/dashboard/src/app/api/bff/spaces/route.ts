import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

export async function GET(request: NextRequest) {
  return proxyBff(request, "/v1/spaces", { method: "GET" });
}

// Creates an organization (Space) owned by the signed-in user.
export async function POST(request: NextRequest) {
  return proxyBff(request, "/v1/spaces", { method: "POST", body: await request.text() });
}
