import { type NextRequest } from "next/server";
import { proxyBff } from "@/lib/bffProxy";

export async function GET(request: NextRequest) {
  return proxyBff(request, `/v1/payments${request.nextUrl.search}`, { method: "GET" });
}
