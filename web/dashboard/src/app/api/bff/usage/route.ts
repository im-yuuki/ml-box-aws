import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

export async function GET(request: NextRequest) {
  // The Space decides which quota, credits and sessions are reported.
  return proxyBff(request, `/v1/usage${request.nextUrl.search}`, { method: "GET" });
}
